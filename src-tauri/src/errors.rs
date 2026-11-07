//! Errors that the UI can localise.
//!
//! API clients keep getting the stable `code` and the default-language `message`; on top of that every
//! `AppError` carries an i18n `key` (`error.<key>` in the frontend locales) and interpolation `args`.
//! Keep keys stable: renaming one orphans its translations.

use axum::http::StatusCode;
use serde_json::{Value, json};
use std::fmt;

#[derive(Debug, Clone)]
pub struct AppError {
    pub code: &'static str,
    pub key: &'static str,
    pub args: Value,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, key: &'static str, args: Value, message: impl Into<String>) -> AppError {
        AppError { code, key, args, message: message.into() }
    }

    /// Key as the frontend knows it: `error.<key>`.
    pub fn full_key(&self) -> String {
        format!("error.{}", self.key)
    }
}

/// `invalid_request` (HTTP 400).
pub fn invalid(key: &'static str, args: Value, message: impl Into<String>) -> AppError {
    AppError::new("invalid_request", key, args, message)
}

/// `not_found` (HTTP 404).
pub fn not_found(key: &'static str, args: Value, message: impl Into<String>) -> AppError {
    AppError::new("not_found", key, args, message)
}

/// Same `code: message` shape the service layer has always produced, so plain-text logs and the
/// `code: message` parsing of untyped errors keep working.
impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

/// The first `AppError` in an `anyhow` chain (it may have been wrapped with `.context`).
pub fn find(e: &anyhow::Error) -> Option<&AppError> {
    e.chain().find_map(|c| c.downcast_ref::<AppError>())
}

/// The i18n part of an error, for payloads that are not HTTP error bodies
/// (SSE error events, stored episode failures).
pub fn i18n_fields(e: &anyhow::Error) -> (Option<String>, Option<Value>) {
    match find(e) {
        Some(a) => (Some(a.full_key()), Some(a.args.clone())),
        None => (None, None),
    }
}

pub fn status_of(code: &str) -> StatusCode {
    match code {
        "not_found" => StatusCode::NOT_FOUND,
        c if c.starts_with("invalid") || c == "cast_missing" => StatusCode::BAD_REQUEST,
        c if c.starts_with("engine_unavailable") || c == "engine_starting" || c == "engine_no_model" => StatusCode::SERVICE_UNAVAILABLE,
        "not_rendered" | "render_incomplete" | "conflict" => StatusCode::CONFLICT,
        "engine_error" => StatusCode::BAD_GATEWAY,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Error type of Tauri commands: the frontend receives `{message, message_key, message_args}`.
#[derive(serde::Serialize)]
pub struct CommandError {
    pub message: String,
    pub message_key: &'static str,
    pub message_args: Value,
}

impl CommandError {
    pub fn new(key: &'static str, args: Value, message: impl Into<String>) -> CommandError {
        CommandError { message: message.into(), message_key: key, message_args: args }
    }

    /// Unexpected system error without a dedicated translation.
    pub fn io(e: impl fmt::Display) -> CommandError {
        CommandError::new("error.io", json!({"detail": e.to_string()}), e.to_string())
    }
}
