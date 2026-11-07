use super::{ApiResult, ok};
use crate::errors;
use crate::service as svc;
use crate::state::Shared;
use crate::types::*;
use axum::Json;
use axum::extract::{Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::convert::Infallible;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

pub async fn status(State(state): State<Shared>) -> ApiResult {
    let s = state.settings();
    let jobs = state.jobs.lock();
    let running = jobs.iter().filter(|j| j.status == "running").count();
    let queued = jobs.iter().filter(|j| j.status == "queued").count();
    drop(jobs);
    ok(json!({
        "app_version": state.version,
        "api": {
            "base_url": super::local_base_url(&state),
            "lan_url": super::lan_ip().map(|ip| format!("http://{ip}:{}", s.api_port)),
            "port": s.api_port,
        },
        "engine": state.engine.status(),
        "model": {"active_package": s.active_package, "installed": state.installed_packages()},
        "queue": {"running": running, "queued": queued},
        "data_dir": state.paths.data,
    }))
}

pub async fn capabilities() -> ApiResult {
    ok(json!({
        "model": "BreezeTTS 2 (3B, GGUF via audio.cpp)",
        "sample_rate": 24000,
        "languages": ["zh", "en"],
        "features": {
            "voice_design": "Describe a voice in natural language (instruct) without reference audio. Use guidance_scale 4. Write the description in the language of the text.",
            "voice_clone": "Reference WAV (clean speech, 3-20 s) plus its exact transcript.",
            "voice_direction": "Clone + instruct to steer emotion, tone, pace and delivery.",
            "vocal_events": "Inline tags in the text.",
            "streaming": "POST /api/v1/speech/stream, first audio in ~0.2 s.",
            "long_form": "Text is chunked automatically; podcasts are rendered line by line and stitched."
        },
        "vocal_events": {"en": svc::VOCAL_EVENTS_EN, "zh": svc::VOCAL_EVENTS_ZH},
        "params": [
            {"name": "guidance_scale", "type": "float", "min": 0, "default": "auto (4 when an instruction is present, else 1)", "description": "Classifier-free guidance; higher follows the instruction more closely but is ~2x slower."},
            {"name": "temperature", "type": "float", "min_exclusive": 0, "default": 0.9, "description": "Backbone sampling temperature; lower = steadier, higher = more expressive."},
            {"name": "depth_temperature", "type": "float", "min_exclusive": 0, "default": 0.9, "description": "Depth decoder sampling temperature (acoustic detail)."},
            {"name": "top_k", "type": "int", "default": 50, "description": "<=0 disables."},
            {"name": "top_p", "type": "float", "range": "(0,1]", "default": 1.0},
            {"name": "seed", "type": "int", "min": 0, "default": "random", "description": "Same seed and inputs reproduce a take."},
            {"name": "max_tokens", "type": "int", "default": 1500, "description": "Max acoustic frames per chunk (12.5 frames/s)."},
            {"name": "text_chunk_size", "type": "int", "default": 600},
            {"name": "text_chunk_mode", "type": "enum", "values": ["default", "tag_aware", "endline"], "default": "default"}
        ],
        "script_format": {
            "turn": "Speaker: text  |  Speaker {direction}: text  (':' or '：')",
            "pause": "<pause 1.5s> or <pause 800ms> on its own line, applies after the previous line",
            "continuation": "a line without a speaker prefix continues the previous line",
            "comment": "'# ' lines are ignored"
        },
        "packages": packages_brief(),
    }))
}

fn packages_brief() -> Vec<Value> {
    crate::packages::PACKAGES.iter().map(|p| json!({"id": p.id, "precision": p.precision, "size_bytes": p.size})).collect()
}

pub async fn get_settings(State(state): State<Shared>) -> ApiResult {
    ok(state.settings())
}

#[derive(Deserialize)]
pub struct SettingsPatch {
    active_package: Option<String>,
    bf16_activations: Option<String>,
    default_params: Option<Params>,
    api_port: Option<u16>,
    keep_model_loaded: Option<bool>,
    export_dir: Option<Option<String>>,
}

pub async fn patch_settings(State(state): State<Shared>, Json(p): Json<SettingsPatch>) -> ApiResult {
    let old = state.settings();
    let mut s = old.clone();
    if let Some(v) = p.active_package {
        let pkg = crate::packages::find(&v).ok_or_else(|| errors::invalid("package_unknown", serde_json::json!({"id": v}), "未知模型包"))?;
        if !pkg.path(&state.paths.models).exists() {
            return Err(errors::invalid("model_not_downloaded", serde_json::json!({}), "该模型包尚未下载").into());
        }
        s.active_package = v;
    }
    if let Some(v) = p.bf16_activations {
        if !["auto", "on", "off"].contains(&v.as_str()) {
            return Err(errors::invalid("bf16_invalid", serde_json::json!({}), "bf16_activations 只能是 auto / on / off").into());
        }
        s.bf16_activations = v;
    }
    if let Some(v) = p.default_params {
        v.validate()?;
        s.default_params = v;
    }
    if let Some(v) = p.api_port {
        if v < 1024 {
            return Err(errors::invalid("port_invalid", serde_json::json!({}), "端口需 >= 1024").into());
        }
        s.api_port = v;
    }
    if let Some(v) = p.keep_model_loaded {
        s.keep_model_loaded = v;
    }
    if let Some(v) = p.export_dir {
        s.export_dir = v.filter(|d| !d.trim().is_empty());
    }
    state.save_settings(s.clone())?;
    let engine_changed = s.active_package != old.active_package
        || s.bf16_activations != old.bf16_activations
        || s.keep_model_loaded != old.keep_model_loaded;
    if engine_changed {
        let st = state.clone();
        tokio::spawn(async move { st.restart_engine().await });
    }
    let mut v = serde_json::to_value(&s).unwrap();
    v["restart_required"] = json!(s.api_port != old.api_port);
    ok(v)
}

pub async fn restart_engine(State(state): State<Shared>) -> ApiResult {
    let st = state.clone();
    tokio::spawn(async move { st.restart_engine().await });
    ok(json!({"ok": true}))
}

pub async fn engine_logs(State(state): State<Shared>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    let n = q.get("lines").and_then(|v| v.parse().ok()).unwrap_or(200);
    ok(json!({"lines": state.engine.logs(n)}))
}

pub async fn events(State(state): State<Shared>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let hello = json!({"type": "engine", "engine": state.engine.status()});
    let first = tokio_stream::once(Ok(Event::default().data(hello.to_string())));
    let rest = BroadcastStream::new(state.events.subscribe())
        .filter_map(|m| m.ok())
        .map(|v| Ok(Event::default().data(v.to_string())));
    Sse::new(first.chain(rest)).keep_alive(KeepAlive::default())
}
