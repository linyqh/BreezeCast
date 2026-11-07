use super::{ApiResult, ok};
use crate::errors::{self, AppError};
use crate::packages::{self, DownloadProgress};
use crate::state::Shared;
use axum::extract::{Path, State};
use serde_json::json;

pub async fn list(State(state): State<Shared>) -> ApiResult {
    let s = state.settings();
    let downloads = state.downloads.lock().clone();
    let items: Vec<_> = packages::PACKAGES
        .iter()
        .map(|p| {
            json!({
                "id": p.id, "precision": p.precision, "file": p.file, "size_bytes": p.size,
                "label": p.label,
                "installed": p.path(&state.paths.models).exists(),
                "active": s.active_package == p.id,
                "recommended": p.precision == "q8_0",
                "download": downloads.get(p.id),
            })
        })
        .collect();
    ok(items)
}

pub async fn download(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let pkg = packages::find(&id).ok_or_else(|| errors::not_found("package_unknown", json!({"id": id}), "未知模型包"))?;
    if pkg.path(&state.paths.models).exists() {
        return Err(AppError::new("conflict", "model_installed", json!({}), "该模型包已安装").into());
    }
    if let Some(job) = state.active_job_for(&id) {
        return ok(job);
    }
    let job = state.create_job("model_download", &id, "job.download_queued", json!({"precision": pkg.precision}), &format!("下载 {}", pkg.precision));
    let st = state.clone();
    let job_id = job.id.clone();
    tokio::spawn(async move {
        st.update_job(&job_id, |j| j.status = "running".into());
        let flag = st.cancel_flag(&job_id);
        let st2 = st.clone();
        let jid = job_id.clone();
        let res = packages::download(pkg, &st.paths.models, flag, move |bytes, total| {
            let progress = bytes as f64 / total as f64;
            st2.downloads.lock().insert(pkg.id.to_string(), DownloadProgress { bytes, total, progress, job_id: jid.clone() });
            st2.update_job(&jid, |j| {
                j.progress = progress;
                j.set_text(format!("{:.1} / {:.1} GB", bytes as f64 / 1e9, total as f64 / 1e9));
            });
        })
        .await;
        st.downloads.lock().remove(pkg.id);
        match res {
            Ok(_) => {
                st.update_job(&job_id, |j| {
                    j.status = "succeeded".into();
                    j.progress = 1.0;
                    j.set_message("job.installed", json!({}), "已安装");
                });
                if st.engine.status().state == "no_model" {
                    let mut s = st.settings();
                    s.active_package = pkg.id.into();
                    let _ = st.save_settings(s);
                    st.restart_engine().await;
                }
            }
            Err(e) => {
                let msg = format!("{e:#}");
                st.update_job(&job_id, |j| {
                    j.status = if msg == "cancelled" { "cancelled" } else { "failed" }.into();
                    j.error = Some(msg);
                });
            }
        }
    });
    ok(job)
}

pub async fn activate(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let pkg = packages::find(&id).ok_or_else(|| errors::not_found("package_unknown", json!({"id": id}), "未知模型包"))?;
    if !pkg.path(&state.paths.models).exists() {
        return Err(errors::invalid("model_not_downloaded", json!({}), "该模型包尚未下载").into());
    }
    let mut s = state.settings();
    s.active_package = id;
    state.save_settings(s.clone())?;
    let st = state.clone();
    tokio::spawn(async move { st.restart_engine().await });
    ok(s)
}

pub async fn delete(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let pkg = packages::find(&id).ok_or_else(|| errors::not_found("package_unknown", json!({"id": id}), "未知模型包"))?;
    let active = state.settings().active_package == id;
    if active {
        state.engine.stop().await;
    }
    let _ = std::fs::remove_file(pkg.path(&state.paths.models));
    let _ = std::fs::remove_file(state.paths.models.join(format!("{}.part", pkg.file)));
    if active {
        state.restart_engine().await;
    }
    ok(json!({"ok": true}))
}
