use super::{ApiError, ApiResult, base_url, ok, serve_file};
use crate::script;
use crate::service as svc;
use crate::state::{RenderTask, Shared};
use crate::types::*;
use axum::Json;
use axum::extract::{Path, Query, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::time::Duration;

fn show(state: &Shared, id: &str) -> Result<Show, ApiError> {
    state.db.get::<Show>("shows", id)?.ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "节目不存在"))
}

fn show_json(state: &Shared, s: &Show, episodes: &[Episode]) -> Value {
    let mut v = serde_json::to_value(s).unwrap();
    v["episode_count"] = json!(episodes.iter().filter(|e| e.show_id.as_deref() == Some(&s.id)).count());
    let _ = state;
    v
}

pub fn episode_json(state: &Shared, ep: &Episode, with_lines: bool) -> Value {
    let base = base_url(state);
    let mut v = serde_json::to_value(ep).unwrap();
    v["status"] = json!(svc::episode_status(state, ep));
    if let Some(a) = &ep.audio {
        v["audio"]["url"] = json!(format!("{base}/api/v1/episodes/{}/audio", ep.id));
        v["audio"]["rendered_at"] = json!(a.rendered_at.split('#').next().unwrap_or_default());
    }
    v["job"] = json!(state.active_job_for(&ep.id));
    if with_lines {
        let lines: Vec<Value> = ep
            .lines
            .iter()
            .map(|l| {
                let mut lv = serde_json::to_value(l).unwrap();
                lv["stale"] = json!(svc::line_is_stale(state, ep, l));
                if l.audio.is_some() {
                    lv["audio"]["url"] = json!(format!("{base}/api/v1/episodes/{}/lines/{}/audio", ep.id, l.id));
                }
                lv
            })
            .collect();
        v["lines"] = json!(lines);
    } else {
        v.as_object_mut().unwrap().remove("lines");
        v["line_count"] = json!(ep.lines.len());
        v["audio"].as_object_mut().map(|a| a.remove("chapters"));
    }
    v
}

// ---------- shows ----------

pub async fn list_shows(State(state): State<Shared>) -> ApiResult {
    let shows: Vec<Show> = state.db.list("shows", None)?;
    let eps: Vec<Episode> = state.db.list("episodes", None)?;
    ok(shows.iter().map(|s| show_json(&state, s, &eps)).collect::<Vec<_>>())
}

#[derive(Deserialize)]
pub struct ShowBody {
    title: Option<String>,
    description: Option<String>,
    author: Option<String>,
    language: Option<String>,
    color: Option<String>,
}

pub async fn create_show(State(state): State<Shared>, Json(b): Json<ShowBody>) -> ApiResult {
    let title = b.title.filter(|t| !t.trim().is_empty()).ok_or_else(|| ApiError::bad("title 不能为空"))?;
    let s = Show {
        id: new_id("s"),
        title: title.trim().into(),
        description: b.description.unwrap_or_default(),
        author: b.author.unwrap_or_default(),
        language: b.language.unwrap_or_else(auto_lang),
        color: b.color.unwrap_or_else(|| "#5E5CE6".into()),
        created_at: now(),
        updated_at: now(),
    };
    state.db.put("shows", &s.id, &s.created_at, &s)?;
    state.emit(json!({"type": "shows"}));
    ok(show_json(&state, &s, &[]))
}

pub async fn get_show(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let eps: Vec<Episode> = state.db.list("episodes", None)?;
    ok(show_json(&state, &show(&state, &id)?, &eps))
}

pub async fn patch_show(State(state): State<Shared>, Path(id): Path<String>, Json(b): Json<ShowBody>) -> ApiResult {
    let mut s = show(&state, &id)?;
    if let Some(v) = b.title.filter(|t| !t.trim().is_empty()) {
        s.title = v.trim().into();
    }
    if let Some(v) = b.description {
        s.description = v;
    }
    if let Some(v) = b.author {
        s.author = v;
    }
    if let Some(v) = b.language {
        s.language = v;
    }
    if let Some(v) = b.color {
        s.color = v;
    }
    s.updated_at = now();
    state.db.put("shows", &s.id, &s.created_at, &s)?;
    state.emit(json!({"type": "shows"}));
    let eps: Vec<Episode> = state.db.list("episodes", None)?;
    ok(show_json(&state, &s, &eps))
}

/// Episodes of a deleted show are kept and become standalone.
pub async fn delete_show(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    show(&state, &id)?;
    for mut ep in state.db.list::<Episode>("episodes", None)? {
        if ep.show_id.as_deref() == Some(&id) {
            ep.show_id = None;
            svc::save_episode(&state, &mut ep)?;
        }
    }
    state.db.delete("shows", &id)?;
    state.emit(json!({"type": "shows"}));
    ok(json!({"ok": true}))
}

// ---------- episodes ----------

#[derive(Deserialize, Clone)]
pub struct LineInput {
    id: Option<String>,
    speaker: String,
    text: String,
    #[serde(default)]
    direction: String,
    pause_ms: Option<u64>,
    params: Option<Params>,
}

/// Keeps rendered audio for lines that are unchanged (matched by id, else by content in order).
fn build_lines(inputs: Vec<LineInput>, old: &[Line]) -> Result<Vec<Line>, ApiError> {
    let mut used: Vec<bool> = vec![false; old.len()];
    inputs
        .into_iter()
        .map(|i| {
            if let Some(p) = &i.params {
                p.validate().map_err(ApiError::bad)?;
            }
            let by_id = i.id.as_ref().and_then(|id| old.iter().position(|l| &l.id == id));
            let by_content = || {
                old.iter().enumerate().position(|(k, l)| !used[k] && l.speaker == i.speaker.trim() && l.text == i.text.trim() && l.direction == i.direction.trim())
            };
            let prev = by_id.or_else(by_content);
            if let Some(k) = prev {
                used[k] = true;
            }
            let prev = prev.map(|k| &old[k]);
            Ok(Line {
                id: prev.map(|l| l.id.clone()).unwrap_or_else(|| new_id("l")),
                speaker: i.speaker.trim().into(),
                text: i.text.trim().into(),
                direction: i.direction.trim().into(),
                pause_ms: i.pause_ms.unwrap_or(default_pause()),
                params: i.params.or_else(|| prev.and_then(|l| l.params.clone())),
                audio: prev.and_then(|l| l.audio.clone()),
            })
        })
        .collect()
}

fn script_inputs(s: &str) -> Vec<LineInput> {
    script::parse(s)
        .lines
        .into_iter()
        .map(|l| LineInput { id: None, speaker: l.speaker, text: l.text, direction: l.direction, pause_ms: Some(l.pause_ms), params: None })
        .collect()
}

/// Fills in cast entries for new speakers, matching a voice by name when possible.
fn complete_cast(state: &Shared, ep: &mut Episode) -> Result<(), ApiError> {
    let voices: Vec<Voice> = state.db.list("voices", None)?;
    let mut speakers: Vec<String> = Vec::new();
    for l in &ep.lines {
        if !speakers.contains(&l.speaker) {
            speakers.push(l.speaker.clone());
        }
    }
    for sp in speakers {
        if !ep.cast.iter().any(|c| c.speaker == sp)
            && let Some(v) = voices.iter().find(|v| v.name == sp)
        {
            ep.cast.push(CastMember { speaker: sp, voice_id: v.id.clone() });
        }
    }
    for c in &ep.cast {
        if !voices.iter().any(|v| v.id == c.voice_id) {
            return Err(ApiError::bad(format!("角色“{}”指定的声音 {} 不存在", c.speaker, c.voice_id)));
        }
    }
    Ok(())
}

pub async fn list_episodes(State(state): State<Shared>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    let eps: Vec<Episode> = state.db.list("episodes", None)?;
    let show_id = q.get("show_id");
    ok(eps
        .iter()
        .filter(|e| show_id.is_none_or(|s| e.show_id.as_ref() == Some(s)))
        .map(|e| episode_json(&state, e, false))
        .collect::<Vec<_>>())
}

#[derive(Deserialize)]
pub struct EpisodeBody {
    show_id: Option<Option<String>>,
    title: Option<String>,
    description: Option<String>,
    language: Option<String>,
    cast: Option<Vec<CastMember>>,
    lines: Option<Vec<LineInput>>,
    script: Option<String>,
    params: Option<Params>,
}

fn apply_episode(state: &Shared, ep: &mut Episode, b: EpisodeBody) -> Result<(), ApiError> {
    if let Some(s) = b.show_id {
        if let Some(id) = &s {
            show(state, id)?;
        }
        ep.show_id = s;
    }
    if let Some(v) = b.title.filter(|t| !t.trim().is_empty()) {
        ep.title = v.trim().into();
    }
    if let Some(v) = b.description {
        ep.description = v;
    }
    if let Some(v) = b.language {
        ep.language = v;
    }
    if let Some(v) = b.params {
        v.validate().map_err(ApiError::bad)?;
        ep.params = v;
    }
    if let Some(v) = b.cast {
        ep.cast = v;
    }
    let inputs = match (b.lines, b.script) {
        (Some(l), _) => Some(l),
        (None, Some(s)) => Some(script_inputs(&s)),
        _ => None,
    };
    if let Some(inputs) = inputs {
        ep.lines = build_lines(inputs, &ep.lines)?;
    }
    ep.failed = None;
    complete_cast(state, ep)
}

pub async fn create_episode(State(state): State<Shared>, Json(b): Json<EpisodeBody>) -> ApiResult {
    let mut ep = Episode {
        id: new_id("e"),
        show_id: None,
        title: "未命名单集".into(),
        description: String::new(),
        language: auto_lang(),
        cast: vec![],
        lines: vec![],
        params: Params::default(),
        audio: None,
        failed: None,
        created_at: now(),
        updated_at: now(),
    };
    apply_episode(&state, &mut ep, b)?;
    svc::save_episode(&state, &mut ep)?;
    ok(episode_json(&state, &ep, true))
}

pub async fn get_episode(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    ok(episode_json(&state, &svc::episode(&state, &id)?, true))
}

pub async fn patch_episode(State(state): State<Shared>, Path(id): Path<String>, Json(b): Json<EpisodeBody>) -> ApiResult {
    let mut ep = svc::episode(&state, &id)?;
    apply_episode(&state, &mut ep, b)?;
    svc::save_episode(&state, &mut ep)?;
    ok(episode_json(&state, &ep, true))
}

pub async fn delete_episode(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    svc::episode(&state, &id)?;
    if let Some(j) = state.active_job_for(&id) {
        state.cancel_flag(&j.id).set();
    }
    let _ = std::fs::remove_dir_all(state.paths.episodes.join(&id));
    state.db.delete("episodes", &id)?;
    state.emit(json!({"type": "episode", "episode_id": id}));
    ok(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct AddLine {
    after_line_id: Option<String>,
    #[serde(flatten)]
    line: LineInput,
}

pub async fn add_line(State(state): State<Shared>, Path(id): Path<String>, Json(b): Json<AddLine>) -> ApiResult {
    let mut ep = svc::episode(&state, &id)?;
    let mut input = b.line;
    input.id = None;
    let line = build_lines(vec![input], &[])?.remove(0);
    let pos = b
        .after_line_id
        .and_then(|a| ep.lines.iter().position(|l| l.id == a))
        .map(|p| p + 1)
        .unwrap_or(ep.lines.len());
    ep.lines.insert(pos, line);
    complete_cast(&state, &mut ep)?;
    svc::save_episode(&state, &mut ep)?;
    ok(episode_json(&state, &ep, true))
}

#[derive(Deserialize)]
pub struct LinePatch {
    speaker: Option<String>,
    text: Option<String>,
    direction: Option<String>,
    pause_ms: Option<u64>,
    #[serde(default)]
    params: Option<Value>,
    move_to: Option<usize>,
}

pub async fn patch_line(State(state): State<Shared>, Path((id, line_id)): Path<(String, String)>, Json(p): Json<LinePatch>) -> ApiResult {
    let mut ep = svc::episode(&state, &id)?;
    let idx = ep.lines.iter().position(|l| l.id == line_id).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "台词不存在"))?;
    {
        let l = &mut ep.lines[idx];
        if let Some(v) = p.speaker.filter(|s| !s.trim().is_empty()) {
            l.speaker = v.trim().into();
        }
        if let Some(v) = p.text {
            l.text = v.trim().into();
        }
        if let Some(v) = p.direction {
            l.direction = v.trim().into();
        }
        if let Some(v) = p.pause_ms {
            l.pause_ms = v.min(30_000);
        }
        match p.params {
            Some(Value::Null) => l.params = None,
            Some(v) => {
                let params: Params = serde_json::from_value(v).map_err(|e| ApiError::bad(e.to_string()))?;
                params.validate().map_err(ApiError::bad)?;
                l.params = Some(params);
            }
            None => {}
        }
    }
    if let Some(to) = p.move_to {
        let l = ep.lines.remove(idx);
        ep.lines.insert(to.min(ep.lines.len()), l);
    }
    complete_cast(&state, &mut ep)?;
    svc::save_episode(&state, &mut ep)?;
    ok(episode_json(&state, &ep, true))
}

pub async fn delete_line(State(state): State<Shared>, Path((id, line_id)): Path<(String, String)>) -> ApiResult {
    let mut ep = svc::episode(&state, &id)?;
    if let Some(pos) = ep.lines.iter().position(|l| l.id == line_id) {
        let l = ep.lines.remove(pos);
        if let Some(a) = l.audio {
            let _ = std::fs::remove_file(a.path);
        }
    }
    svc::save_episode(&state, &mut ep)?;
    ok(episode_json(&state, &ep, true))
}

#[derive(Deserialize, Default)]
pub struct LineRenderBody {
    #[serde(default)]
    params: Params,
}

/// Synchronous single-line take. Without a seed a fresh take is generated.
pub async fn render_line(
    State(state): State<Shared>,
    Path((id, line_id)): Path<(String, String)>,
    body: Option<Json<LineRenderBody>>,
) -> ApiResult {
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let ep = svc::episode(&state, &id)?;
    let mut line = ep.lines.iter().find(|l| l.id == line_id).cloned().ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "台词不存在"))?;
    let original = line.clone();
    let force = b.params.seed.is_none();
    if b.params != Params::default() {
        line.params = Some(line.params.clone().unwrap_or_default().overlay(&b.params));
    }
    let mut audio = svc::render_line(&state, &ep, &line, force).await?;
    // The hash ignores ad-hoc params so the take is accepted as current for the stored line.
    if let Some(h) = svc::line_hash(&state, &ep, &original) {
        audio.hash = h;
    }
    let ep = svc::store_line_audio(&state, &id, &original, audio)?;
    ok(episode_json(&state, &ep, true))
}

pub async fn line_audio(State(state): State<Shared>, Path((id, line_id)): Path<(String, String)>, req: Request) -> ApiResult<Response> {
    let ep = svc::episode(&state, &id)?;
    let a = ep
        .lines
        .iter()
        .find(|l| l.id == line_id)
        .and_then(|l| l.audio.clone())
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "该台词尚未生成"))?;
    serve_file(a.path.into(), req).await
}

#[derive(Deserialize, Default)]
pub struct RenderBody {
    line_ids: Option<Vec<String>>,
    #[serde(default)]
    force: bool,
    #[serde(default)]
    wait: bool,
}

pub async fn render(State(state): State<Shared>, Path(id): Path<String>, body: Option<Json<RenderBody>>) -> ApiResult {
    let b = body.map(|Json(b)| b).unwrap_or_default();
    let ep = svc::episode(&state, &id)?;
    if ep.lines.is_empty() {
        return Err(ApiError::bad("单集没有台词"));
    }
    for l in &ep.lines {
        svc::line_request(&state, &ep, l)?;
    }
    let job = match state.active_job_for(&id) {
        Some(j) => j,
        None => {
            let job = state.create_job("render_episode", &id, "job.render_queued", json!({"title": ep.title}), &format!("渲染《{}》", ep.title));
            state
                .render_tx
                .send(RenderTask { job_id: job.id.clone(), episode_id: id.clone(), line_ids: b.line_ids, force: b.force })
                .map_err(|_| ApiError::from(anyhow::anyhow!("internal: 渲染队列不可用")))?;
            job
        }
    };
    if !b.wait {
        return ok(job);
    }
    loop {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let j = state.job(&job.id).ok_or_else(|| ApiError::from(anyhow::anyhow!("internal: job lost")))?;
        if matches!(j.status.as_str(), "succeeded" | "failed" | "cancelled") {
            return ok(j);
        }
    }
}

pub async fn episode_audio(State(state): State<Shared>, Path(id): Path<String>, req: Request) -> ApiResult<Response> {
    let ep = svc::episode(&state, &id)?;
    let a = ep.audio.ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "not_rendered", "单集尚未渲染"))?;
    serve_file(a.path.into(), req).await
}

#[derive(Deserialize)]
pub struct ExportBody {
    #[serde(default = "m4a")]
    format: String,
    dir: Option<String>,
}
fn m4a() -> String {
    "m4a".into()
}

pub async fn export(State(state): State<Shared>, Path(id): Path<String>, Json(b): Json<ExportBody>) -> ApiResult {
    let ep = svc::episode(&state, &id)?;
    let st = state.clone();
    let res = tokio::task::spawn_blocking(move || svc::export(&st, &ep, &b.format, b.dir)).await.map_err(|e| ApiError::bad(e.to_string()))??;
    ok(res)
}

pub async fn transcript(State(state): State<Shared>, Path(id): Path<String>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Response> {
    let ep = svc::episode(&state, &id)?;
    let format = q.get("format").map(String::as_str).unwrap_or("json");
    let body = svc::transcript(&ep, format)?;
    let ctype = if format == "json" { "application/json" } else { "text/plain; charset=utf-8" };
    Ok(([(header::CONTENT_TYPE, ctype)], body).into_response())
}

// ---------- jobs & scripts ----------

pub async fn list_jobs(State(state): State<Shared>, Query(q): Query<HashMap<String, String>>) -> ApiResult {
    let limit = q.get("limit").and_then(|v| v.parse().ok()).unwrap_or(50);
    ok(state.jobs.lock().iter().take(limit).cloned().collect::<Vec<_>>())
}

pub async fn get_job(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    ok(state.job(&id).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "任务不存在"))?)
}

pub async fn cancel_job(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let job = state.job(&id).ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "not_found", "任务不存在"))?;
    state.cancel_flag(&id).set();
    if job.status == "queued" {
        state.update_job(&id, |j| {
            j.status = "cancelled".into();
            j.set_message("job.cancelled", json!({}), "已取消");
        });
    }
    ok(state.job(&id))
}

#[derive(Deserialize)]
pub struct ParseBody {
    script: String,
}

pub async fn parse_script(Json(b): Json<ParseBody>) -> ApiResult {
    ok(script::parse(&b.script))
}
