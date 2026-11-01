mod api;
mod audio;
mod db;
mod engine;
mod packages;
mod script;
mod service;
mod state;
mod types;

use parking_lot::{Mutex, RwLock};
use serde_json::json;
use state::{AppState, Paths, Shared};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, Manager};

static SHARED: OnceLock<Shared> = OnceLock::new();

#[tauri::command]
fn api_info() -> serde_json::Value {
    match SHARED.get() {
        Some(s) => json!({"base_url": api::local_base_url(s), "data_dir": s.paths.data}),
        None => json!(null),
    }
}

const SKILL_DIRS: [(&str, &str); 4] = [
    ("Claude Code", ".claude/skills"),
    ("Codex", ".codex/skills"),
    ("oh-my-pi", ".omp/agent/skills"),
    ("通用 Agents", ".agents/skills"),
];

fn home() -> std::path::PathBuf {
    std::env::home_dir().unwrap_or_default()
}

#[tauri::command]
fn skill_targets() -> serde_json::Value {
    let h = home();
    SKILL_DIRS
        .iter()
        .map(|(name, rel)| {
            let dir = h.join(rel);
            let agent_root = dir.parent().map(|p| p.exists()).unwrap_or(false);
            json!({
                "name": name, "dir": dir, "available": agent_root,
                "installed": dir.join("breezecast").join("SKILL.md").exists(),
            })
        })
        .collect()
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

/// Copies the bundled skill into `<dir>/breezecast`, replacing an older copy.
#[tauri::command]
fn install_skill(app: tauri::AppHandle, dir: String) -> Result<String, String> {
    let src = app
        .path()
        .resolve("skills/breezecast", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let dst = std::path::PathBuf::from(dir).join("breezecast");
    if dst.is_symlink() {
        std::fs::remove_file(&dst).map_err(|e| e.to_string())?;
    } else if dst.exists() {
        std::fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
    }
    copy_dir(&src, &dst).map_err(|e| format!("复制失败：{e}"))?;
    Ok(dst.to_string_lossy().into())
}

fn engine_binary() -> std::path::PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let name = format!("audiocpp_server{}", std::env::consts::EXE_SUFFIX);
    exe.parent().map(|d| d.join(name)).unwrap_or_default()
}

async fn serve_api(state: Shared, app: tauri::AppHandle) {
    let port = state.settings().api_port;
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(e) => {
            let _ = app.emit("api-error", format!("端口 {port} 被占用：{e}"));
            eprintln!("API bind failed on {port}: {e}");
            return;
        }
    };
    let info = json!({
        "base_url": api::local_base_url(&state),
        "lan_url": api::lan_ip().map(|ip| format!("http://{ip}:{port}")),
        "pid": std::process::id(), "version": state.version,
    });
    let _ = std::fs::write(state.paths.data.join("api.json"), serde_json::to_vec_pretty(&info).unwrap());
    if let Err(e) = axum::serve(listener, api::router(state)).await {
        eprintln!("API server stopped: {e}");
    }
}

fn init_state(app: &tauri::AppHandle) -> anyhow::Result<Shared> {
    let data = app.path().app_data_dir()?;
    let paths = Paths::new(data);
    let _ = std::fs::remove_dir_all(&paths.tmp);
    let _ = std::fs::create_dir_all(&paths.tmp);
    let settings: types::Settings = std::fs::read(paths.data.join("settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let (events, _) = tokio::sync::broadcast::channel(512);
    let ev = events.clone();
    let engine = Arc::new(engine::Engine::new(move |s| {
        let _ = ev.send(json!({"type": "engine", "engine": s}));
    }));
    let (render_tx, mut render_rx) = tokio::sync::mpsc::unbounded_channel::<state::RenderTask>();
    let state = Arc::new(AppState {
        db: db::Db::open(&paths.data.join("breezecast.db"))?,
        paths,
        settings: RwLock::new(settings),
        engine,
        engine_binary: engine_binary(),
        events,
        jobs: Mutex::new(Vec::new()),
        cancels: Mutex::new(HashMap::new()),
        downloads: Mutex::new(HashMap::new()),
        render_tx,
        version: app.package_info().version.to_string(),
    });
    let worker = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(task) = render_rx.recv().await {
            if worker.job(&task.job_id).is_some_and(|j| j.status == "queued") {
                service::run_render(worker.clone(), task).await;
            }
        }
    });
    Ok(state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![api_info, skill_targets, install_skill])
        .setup(|app| {
            let state = init_state(app.handle())?;
            let _ = SHARED.set(state.clone());
            let handle = app.handle().clone();
            let st = state.clone();
            tauri::async_runtime::spawn(async move { serve_api(st, handle).await });
            tauri::async_runtime::spawn(async move { state.restart_engine().await });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(s) = SHARED.get()
            {
                let _ = std::fs::remove_file(s.paths.data.join("api.json"));
                tauri::async_runtime::block_on(s.engine.stop());
            }
        });
}
