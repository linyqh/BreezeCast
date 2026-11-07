mod episodes;
mod models;
mod system;
mod voices;

use crate::errors::{self, AppError};
use crate::state::Shared;
use axum::extract::Request;
use axum::http::{StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use std::path::PathBuf;
use tower::ServiceExt;

pub struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
    /// i18n key + args so UIs can localise `message`; `code` and `message` stay the API contract.
    key: Option<String>,
    args: Option<Value>,
}

impl ApiError {
    /// Untranslated error: UIs fall back to `message`. Prefer an `AppError` with an i18n key.
    pub fn new(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
        ApiError { status, code: code.into(), message: message.into(), key: None, args: None }
    }
    pub fn bad(message: impl Into<String>) -> ApiError {
        ApiError::new(StatusCode::BAD_REQUEST, "invalid_request", message)
    }
}

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        let key = e.full_key();
        ApiError { status: errors::status_of(e.code), code: e.code.into(), message: e.message, key: Some(key), args: Some(e.args) }
    }
}

/// Service errors carry a `code: message` prefix; the code picks the HTTP status.
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        if let Some(app) = errors::find(&e) {
            return app.clone().into();
        }
        let full = format!("{e:#}");
        let (code, message) = match full.split_once(": ") {
            Some((c, m)) if !c.is_empty() && c.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_') => (c.to_string(), m.to_string()),
            _ => ("internal".to_string(), full.clone()),
        };
        ApiError { status: errors::status_of(&code), code, message, key: None, args: None }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut error = json!({"code": self.code, "message": self.message});
        if let Some(key) = self.key {
            error["message_key"] = json!(key);
            error["message_args"] = self.args.unwrap_or(Value::Null);
        }
        (self.status, Json(json!({ "error": error }))).into_response()
    }
}

pub type ApiResult<T = Json<Value>> = Result<T, ApiError>;

pub fn ok<T: serde::Serialize>(v: T) -> ApiResult {
    Ok(Json(serde_json::to_value(v).map_err(|e| ApiError::from(anyhow::Error::from(e)))?))
}

tokio::task_local! {
    static REQUEST_ORIGIN: String;
}

/// Origin the current client used to reach us, so returned URLs also work from other LAN devices.
pub fn base_url(state: &Shared) -> String {
    REQUEST_ORIGIN
        .try_with(Clone::clone)
        .unwrap_or_else(|_| local_base_url(state))
}

pub fn local_base_url(state: &Shared) -> String {
    format!("http://127.0.0.1:{}", state.settings().api_port)
}

/// First private IPv4 on a physical interface (en*, bridge*). VPN/proxy tunnels (utun*) and their
/// fake-IP ranges are skipped because other LAN devices cannot reach them.
pub fn lan_ip() -> Option<std::net::IpAddr> {
    let mut candidates: Vec<(bool, std::net::Ipv4Addr)> = if_addrs::get_if_addrs()
        .ok()?
        .into_iter()
        .filter(|i| !i.is_loopback() && (i.name.starts_with("en") || i.name.starts_with("bridge")))
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) if v4.is_private() => Some((i.name.starts_with("en"), v4)),
            _ => None,
        })
        .collect();
    candidates.sort_by_key(|(is_en, _)| !is_en);
    candidates.first().map(|(_, ip)| std::net::IpAddr::V4(*ip))
}

pub async fn serve_file(path: PathBuf, req: Request) -> ApiResult<Response> {
    if !path.exists() {
        return Err(errors::not_found("audio_file_not_found", json!({}), "音频文件不存在").into());
    }
    let res = tower_http::services::ServeFile::new(path).oneshot(req).await.map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(res.map(axum::body::Body::new))
}

async fn capture_origin(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(|h| format!("http://{h}"));
    match origin {
        Some(o) => REQUEST_ORIGIN.scope(o, next.run(req)).await,
        None => next.run(req).await,
    }
}

pub fn router(state: Shared) -> Router {
    let api = Router::new()
        .route("/status", get(system::status))
        .route("/capabilities", get(system::capabilities))
        .route("/settings", get(system::get_settings).patch(system::patch_settings))
        .route("/engine/restart", post(system::restart_engine))
        .route("/engine/logs", get(system::engine_logs))
        .route("/events", get(system::events))
        .route("/models", get(models::list))
        .route("/models/{id}", axum::routing::delete(models::delete))
        .route("/models/{id}/download", post(models::download))
        .route("/models/{id}/activate", post(models::activate))
        .route("/speech", post(voices::speech))
        .route("/speech/stream", post(voices::speech_stream))
        .route("/clips", get(voices::list_clips))
        .route("/clips/{id}", get(voices::get_clip).delete(voices::delete_clip))
        .route("/clips/{id}/audio", get(voices::clip_audio))
        .route("/voices", get(voices::list_voices).post(voices::create_voice))
        .route("/voices/audition", post(voices::audition))
        .route("/voices/{id}", get(voices::get_voice).patch(voices::patch_voice).delete(voices::delete_voice))
        .route("/voices/{id}/audio", get(voices::voice_audio))
        .route("/voices/{id}/preview", post(voices::preview_voice))
        .route("/shows", get(episodes::list_shows).post(episodes::create_show))
        .route("/shows/{id}", get(episodes::get_show).patch(episodes::patch_show).delete(episodes::delete_show))
        .route("/episodes", get(episodes::list_episodes).post(episodes::create_episode))
        .route("/episodes/{id}", get(episodes::get_episode).patch(episodes::patch_episode).delete(episodes::delete_episode))
        .route("/episodes/{id}/lines", post(episodes::add_line))
        .route("/episodes/{id}/lines/{line_id}", axum::routing::patch(episodes::patch_line).delete(episodes::delete_line))
        .route("/episodes/{id}/lines/{line_id}/render", post(episodes::render_line))
        .route("/episodes/{id}/lines/{line_id}/audio", get(episodes::line_audio))
        .route("/episodes/{id}/render", post(episodes::render))
        .route("/episodes/{id}/audio", get(episodes::episode_audio))
        .route("/episodes/{id}/export", post(episodes::export))
        .route("/episodes/{id}/transcript", get(episodes::transcript))
        .route("/jobs", get(episodes::list_jobs))
        .route("/jobs/{id}", get(episodes::get_job))
        .route("/jobs/{id}/cancel", post(episodes::cancel_job))
        .route("/scripts/parse", post(episodes::parse_script))
        .layer(middleware::from_fn(capture_origin))
        .layer(axum::extract::DefaultBodyLimit::max(64 << 20));
    let cors = tower_http::cors::CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);
    Router::new()
        .nest("/api/v1", api)
        .route("/", get(|| async { "BreezeCast API — see /api/v1/capabilities" }))
        .layer(cors)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Params;

    async fn body_of(e: impl Into<ApiError>) -> (StatusCode, Value) {
        let res = e.into().into_response();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn typed_error_keeps_contract_and_adds_i18n_fields() {
        // Wrapped in context: the typed error must still be found in the chain.
        let e = anyhow::Error::new(AppError::new("cast_missing", "cast_missing", json!({"speaker": "A"}), "角色“A”还没有分配声音")).context("render");
        let (status, v) = body_of(e).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(v["error"]["code"], "cast_missing");
        assert_eq!(v["error"]["message"], "角色“A”还没有分配声音");
        assert_eq!(v["error"]["message_key"], "error.cast_missing");
        assert_eq!(v["error"]["message_args"]["speaker"], "A");
    }

    #[tokio::test]
    async fn untyped_error_has_no_i18n_fields() {
        let (status, v) = body_of(anyhow::anyhow!("not_found: 声音 v1 不存在")).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(v["error"]["code"], "not_found");
        assert_eq!(v["error"]["message"], "声音 v1 不存在");
        assert!(v["error"].get("message_key").is_none());
    }

    #[tokio::test]
    async fn param_validation_error_is_typed_bad_request() {
        let p = Params { temperature: Some(-1.0), ..Default::default() };
        let (status, v) = body_of(p.validate().unwrap_err()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(v["error"]["code"], "invalid_request");
        assert_eq!(v["error"]["message"], "temperature must be > 0");
        assert_eq!(v["error"]["message_key"], "error.param_positive");
    }
}
