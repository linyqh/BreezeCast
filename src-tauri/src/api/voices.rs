use super::{ApiError, ApiResult, base_url, ok, serve_file};
use crate::engine::SpeechRequest;
use crate::errors;
use crate::service::{self as svc, build_request};
use crate::state::Shared;
use crate::types::*;
use axum::Json;
use axum::extract::{Path, Query, Request, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;

pub fn clip_json(state: &Shared, c: &Clip) -> Value {
    let mut v = serde_json::to_value(c).unwrap();
    v["url"] = json!(format!("{}/api/v1/clips/{}/audio", base_url(state), c.id));
    v
}

pub fn voice_json(state: &Shared, v: &Voice) -> Value {
    let mut j = serde_json::to_value(v).unwrap();
    j["has_reference"] = json!(v.ref_path.is_some());
    j["ref_url"] = match &v.ref_path {
        Some(_) => json!(format!("{}/api/v1/voices/{}/audio", base_url(state), v.id)),
        None => Value::Null,
    };
    j
}

/// Writes inline/path reference audio into `dest` as normalized WAV.
fn take_reference(state: &Shared, b64: Option<&str>, path: Option<&str>, dest: &std::path::Path) -> Result<bool, ApiError> {
    let src: PathBuf = if let Some(b) = b64 {
        let data = b.split_once("base64,").map(|(_, d)| d).unwrap_or(b);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|_| errors::invalid("ref_audio_base64_invalid", json!({}), "ref_audio_base64 不是有效的 base64"))?;
        let tmp = state.paths.tmp.join(new_id("upload"));
        std::fs::write(&tmp, bytes).map_err(anyhow::Error::from)?;
        tmp
    } else if let Some(p) = path {
        let p = PathBuf::from(p);
        if !p.is_absolute() || !p.exists() {
            return Err(errors::invalid("ref_audio_path_invalid", json!({}), "ref_audio_path 必须是存在的绝对路径").into());
        }
        p
    } else {
        return Ok(false);
    };
    let r = svc::import_reference(state, &src, dest);
    if b64.is_some() {
        let _ = std::fs::remove_file(&src);
    }
    r?;
    Ok(true)
}

#[derive(Deserialize, Default)]
pub struct SpeechBody {
    text: String,
    voice_id: Option<String>,
    #[serde(default)]
    instruct: String,
    ref_audio_base64: Option<String>,
    ref_audio_path: Option<String>,
    ref_text: Option<String>,
    #[serde(default)]
    params: Params,
}

fn resolve_speech(state: &Shared, b: &SpeechBody) -> Result<SpeechRequest, ApiError> {
    let voice = match &b.voice_id {
        Some(id) if !id.is_empty() => Some(svc::voice(state, id)?),
        _ => None,
    };
    let defaults = state.settings().default_params;
    let empty = Params::default();
    let mut req = build_request(&b.text, voice.as_ref(), &b.instruct, &[&defaults, voice.as_ref().map(|v| &v.params).unwrap_or(&empty), &b.params]);
    let ref_tmp = state.paths.tmp.join(format!("{}.wav", new_id("ref")));
    if take_reference(state, b.ref_audio_base64.as_deref(), b.ref_audio_path.as_deref(), &ref_tmp)? {
        let text = b.ref_text.clone().filter(|t| !t.trim().is_empty()).ok_or_else(|| errors::invalid("ref_text_required", json!({}), "使用参考音频时必须提供 ref_text（参考音频的逐字稿）"))?;
        req.ref_path = Some(ref_tmp.to_string_lossy().into());
        req.ref_text = Some(text);
        req.instruct = b.instruct.clone();
    }
    req.params.validate()?;
    Ok(req)
}

pub async fn speech(State(state): State<Shared>, Json(b): Json<SpeechBody>) -> ApiResult {
    let req = resolve_speech(&state, &b)?;
    let clip = svc::speak(&state, req, b.voice_id.clone(), "speech").await?;
    ok(clip_json(&state, &clip))
}

pub async fn speech_stream(State(state): State<Shared>, Json(b): Json<SpeechBody>) -> Result<Response, ApiError> {
    if b.text.trim().is_empty() {
        return Err(errors::invalid("text_required", json!({}), "text 不能为空").into());
    }
    let mut req = resolve_speech(&state, &b)?;
    req.params.seed.get_or_insert_with(svc::random_seed);
    let voice_id = b.voice_id.clone();
    // The stream body runs after the request-origin scope ends, so resolve the clip URL base now.
    let origin = base_url(&state);
    let stream = async_stream::stream! {
        let _guard = state.engine.busy.lock().await;
        let mut pcm: Vec<i16> = Vec::new();
        let ev = |v: Value| Ok::<Event, std::convert::Infallible>(Event::default().data(v.to_string()));
        match state.engine.stream(&req).await {
            Err(e) => yield ev(error_event(&e)),
            Ok(s) => {
                futures::pin_mut!(s);
                let mut failed = false;
                while let Some(item) = s.next().await {
                    match item {
                        Ok(b64) => {
                            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&b64) {
                                pcm.extend(bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])));
                            }
                            yield ev(json!({"type": "audio", "sample_rate": 24000, "pcm16_base64": b64}));
                        }
                        Err(e) => {
                            failed = true;
                            yield ev(error_event(&e));
                            break;
                        }
                    }
                }
                if !failed {
                    match svc::save_stream_clip(&state, &req, voice_id.clone(), &pcm) {
                        Ok(clip) => {
                            let mut v = clip_json(&state, &clip);
                            v["url"] = json!(format!("{origin}/api/v1/clips/{}/audio", clip.id));
                            yield ev(json!({"type": "done", "clip": v}));
                        }
                        Err(e) => yield ev(error_event(&e)),
                    }
                }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

pub async fn list_clips(State(state): State<Shared>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    let limit = q.get("limit").and_then(|v| v.parse().ok()).unwrap_or(50);
    let clips: Vec<Clip> = state.db.list("clips", Some(limit))?;
    let kind = q.get("kind");
    ok(clips.iter().filter(|c| kind.is_none_or(|k| &c.kind == k)).map(|c| clip_json(&state, c)).collect::<Vec<_>>())
}

/// SSE `error` event: `message` is the API text, `message_key`/`message_args` let UIs localise it.
fn error_event(e: &anyhow::Error) -> Value {
    let mut v = json!({"type": "error", "message": format!("{e:#}")});
    if let (Some(key), Some(args)) = errors::i18n_fields(e) {
        v["message_key"] = json!(key);
        v["message_args"] = args;
    }
    v
}

fn clip(state: &Shared, id: &str) -> Result<Clip, ApiError> {
    state.db.get::<Clip>("clips", id)?.ok_or_else(|| errors::not_found("clip_not_found", json!({"id": id}), "片段不存在").into())
}

pub async fn get_clip(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    ok(clip_json(&state, &clip(&state, &id)?))
}

pub async fn delete_clip(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let c = clip(&state, &id)?;
    let _ = std::fs::remove_file(&c.path);
    state.db.delete("clips", &id)?;
    ok(json!({"ok": true}))
}

pub async fn clip_audio(State(state): State<Shared>, Path(id): Path<String>, req: Request) -> ApiResult<Response> {
    serve_file(clip(&state, &id)?.path.into(), req).await
}

// ---------- voices ----------

pub async fn list_voices(State(state): State<Shared>) -> ApiResult {
    let voices: Vec<Voice> = state.db.list("voices", None)?;
    ok(voices.iter().map(|v| voice_json(&state, v)).collect::<Vec<_>>())
}

pub async fn get_voice(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    ok(voice_json(&state, &svc::voice(&state, &id)?))
}

#[derive(Deserialize)]
pub struct AuditionBody {
    instruct: String,
    text: String,
    #[serde(default = "one")]
    count: usize,
    #[serde(default)]
    params: Params,
}
fn one() -> usize {
    1
}

pub async fn audition(State(state): State<Shared>, Json(b): Json<AuditionBody>) -> ApiResult {
    if b.instruct.trim().is_empty() {
        return Err(errors::invalid("instruct_required", json!({}), "instruct（声音描述）不能为空").into());
    }
    let count = b.count.clamp(1, 6);
    let defaults = state.settings().default_params;
    let mut takes = Vec::new();
    for i in 0..count {
        let mut req = build_request(&b.text, None, &b.instruct, &[&defaults, &b.params]);
        req.params.seed = Some(b.params.seed.map(|s| s + i as u64).unwrap_or_else(svc::random_seed));
        let clip = svc::speak(&state, req, None, "audition").await?;
        takes.push(clip_json(&state, &clip));
    }
    ok(json!({"takes": takes}))
}

#[derive(Deserialize)]
pub struct VoiceBody {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    instruct: String,
    language: Option<String>,
    color: Option<String>,
    source: Option<String>,
    from_clip_id: Option<String>,
    ref_audio_base64: Option<String>,
    ref_audio_path: Option<String>,
    ref_text: Option<String>,
    #[serde(default)]
    params: Params,
}

const COLORS: [&str; 8] = ["#0A84FF", "#BF5AF2", "#FF9F0A", "#30D158", "#FF375F", "#64D2FF", "#5E5CE6", "#FFD60A"];

pub async fn create_voice(State(state): State<Shared>, Json(b): Json<VoiceBody>) -> ApiResult {
    if b.name.trim().is_empty() {
        return Err(errors::invalid("name_required", json!({}), "name 不能为空").into());
    }
    b.params.validate()?;
    let id = new_id("v");
    let dest = state.paths.voices.join(format!("{id}.wav"));
    let (source, ref_path, ref_text) = if let Some(cid) = &b.from_clip_id {
        let c = clip(&state, cid)?;
        std::fs::copy(&c.path, &dest).map_err(anyhow::Error::from)?;
        ("design".to_string(), Some(dest), Some(svc::strip_events(&c.text)))
    } else if take_reference(&state, b.ref_audio_base64.as_deref(), b.ref_audio_path.as_deref(), &dest)? {
        let text = b.ref_text.clone().filter(|t| !t.trim().is_empty()).ok_or_else(|| {
            let _ = std::fs::remove_file(&dest);
            ApiError::from(errors::invalid("ref_text_required_clone", json!({}), "克隆声音需要 ref_text（参考音频的逐字稿）"))
        })?;
        (b.source.clone().unwrap_or_else(|| "clone".into()), Some(dest), Some(text))
    } else {
        if b.instruct.trim().is_empty() {
            return Err(errors::invalid("voice_source_required", json!({}), "需要 from_clip_id、参考音频或 instruct 之一").into());
        }
        ("design".to_string(), None, None)
    };
    let count = state.db.list::<Voice>("voices", None)?.len();
    let v = Voice {
        id: id.clone(),
        name: b.name.trim().into(),
        description: b.description,
        language: b.language.unwrap_or_else(auto_lang),
        source,
        instruct: b.instruct,
        ref_text,
        ref_path: ref_path.map(|p| p.to_string_lossy().into()),
        params: b.params,
        color: b.color.unwrap_or_else(|| COLORS[count % COLORS.len()].into()),
        created_at: now(),
        updated_at: now(),
    };
    state.db.put("voices", &id, &v.created_at, &v)?;
    state.emit(json!({"type": "voices"}));
    ok(voice_json(&state, &v))
}

#[derive(Deserialize)]
pub struct VoicePatch {
    name: Option<String>,
    description: Option<String>,
    instruct: Option<String>,
    ref_text: Option<String>,
    params: Option<Params>,
    color: Option<String>,
    language: Option<String>,
}

pub async fn patch_voice(State(state): State<Shared>, Path(id): Path<String>, Json(p): Json<VoicePatch>) -> ApiResult {
    let mut v = svc::voice(&state, &id)?;
    if let Some(x) = p.name.filter(|n| !n.trim().is_empty()) {
        v.name = x.trim().into();
    }
    if let Some(x) = p.description {
        v.description = x;
    }
    if let Some(x) = p.instruct {
        v.instruct = x;
    }
    if let Some(x) = p.ref_text
        && v.ref_path.is_some()
    {
        v.ref_text = Some(x);
    }
    if let Some(x) = p.params {
        x.validate()?;
        v.params = x;
    }
    if let Some(x) = p.color {
        v.color = x;
    }
    if let Some(x) = p.language {
        v.language = x;
    }
    v.updated_at = now();
    state.db.put("voices", &id, &v.created_at, &v)?;
    state.emit(json!({"type": "voices"}));
    ok(voice_json(&state, &v))
}

pub async fn delete_voice(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let v = svc::voice(&state, &id)?;
    if let Some(p) = &v.ref_path {
        let _ = std::fs::remove_file(p);
    }
    state.db.delete("voices", &id)?;
    state.emit(json!({"type": "voices"}));
    ok(json!({"ok": true}))
}

pub async fn voice_audio(State(state): State<Shared>, Path(id): Path<String>, req: Request) -> ApiResult<Response> {
    let v = svc::voice(&state, &id)?;
    let p = v.ref_path.ok_or_else(|| errors::not_found("voice_no_reference", json!({}), "该声音没有参考音频"))?;
    serve_file(p.into(), req).await
}

#[derive(Deserialize, Default)]
pub struct PreviewBody {
    text: Option<String>,
    #[serde(default)]
    direction: String,
    #[serde(default)]
    params: Params,
}

pub async fn preview_voice(State(state): State<Shared>, Path(id): Path<String>, body: Option<Json<PreviewBody>>) -> ApiResult {
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let v = svc::voice(&state, &id)?;
    let text = b.text.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| {
        if v.language == "en" { "Hi there, welcome to the show. Let's get started.".into() } else { "大家好，欢迎收听本期节目，我们马上开始。".into() }
    });
    let defaults = state.settings().default_params;
    let req = build_request(&text, Some(&v), &b.direction, &[&defaults, &v.params, &b.params]);
    let clip = svc::speak(&state, req, Some(v.id.clone()), "speech").await?;
    ok(clip_json(&state, &clip))
}
