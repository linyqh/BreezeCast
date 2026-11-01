use crate::db::Db;
use crate::engine::{Engine, EngineConfig};
use crate::packages::{self, tokio_util_cancel::Flag};
use crate::types::*;
use parking_lot::{Mutex, RwLock};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

pub struct Paths {
    pub data: PathBuf,
    pub models: PathBuf,
    pub clips: PathBuf,
    pub voices: PathBuf,
    pub episodes: PathBuf,
    pub engine: PathBuf,
    pub tmp: PathBuf,
}

impl Paths {
    pub fn new(data: PathBuf) -> Paths {
        let p = Paths {
            models: data.join("models"),
            clips: data.join("clips"),
            voices: data.join("voices"),
            episodes: data.join("episodes"),
            engine: data.join("engine"),
            tmp: data.join("tmp"),
            data,
        };
        for d in [&p.data, &p.models, &p.clips, &p.voices, &p.episodes, &p.engine, &p.tmp] {
            let _ = std::fs::create_dir_all(d);
        }
        p
    }
}

pub struct RenderTask {
    pub job_id: String,
    pub episode_id: String,
    pub line_ids: Option<Vec<String>>,
    pub force: bool,
}

pub struct AppState {
    pub paths: Paths,
    pub db: Db,
    pub settings: RwLock<Settings>,
    pub engine: Arc<Engine>,
    pub engine_binary: PathBuf,
    pub events: broadcast::Sender<Value>,
    pub jobs: Mutex<Vec<Job>>,
    pub cancels: Mutex<HashMap<String, Flag>>,
    pub downloads: Mutex<HashMap<String, packages::DownloadProgress>>,
    pub render_tx: mpsc::UnboundedSender<RenderTask>,
    pub version: String,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub fn emit(&self, v: Value) {
        let _ = self.events.send(v);
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    pub fn save_settings(&self, s: Settings) -> anyhow::Result<()> {
        std::fs::write(self.paths.data.join("settings.json"), serde_json::to_vec_pretty(&s)?)?;
        *self.settings.write() = s;
        Ok(())
    }

    pub fn active_model_path(&self) -> Option<PathBuf> {
        let s = self.settings();
        packages::find(&s.active_package).map(|p| p.path(&self.paths.models)).filter(|p| p.exists())
    }

    pub fn installed_packages(&self) -> Vec<&'static str> {
        packages::PACKAGES.iter().filter(|p| p.path(&self.paths.models).exists()).map(|p| p.id).collect()
    }

    pub async fn restart_engine(&self) {
        let s = self.settings();
        let mut model_path = self.active_model_path();
        if model_path.is_none()
            && let Some(id) = self.installed_packages().first()
        {
            let mut s2 = s.clone();
            s2.active_package = id.to_string();
            let _ = self.save_settings(s2);
            model_path = self.active_model_path();
        }
        let cfg = EngineConfig {
            binary: self.engine_binary.clone(),
            work_dir: self.paths.engine.clone(),
            model_path,
            bf16_activations: s.bf16_activations.clone(),
            keep_model_loaded: s.keep_model_loaded,
        };
        if let Err(e) = self.engine.start(cfg).await {
            eprintln!("engine start failed: {e:#}");
        }
    }

    // ---- jobs ----

    pub fn create_job(&self, kind: &str, target_id: &str, message: &str) -> Job {
        let job = Job {
            id: new_id("j"),
            kind: kind.into(),
            target_id: target_id.into(),
            status: "queued".into(),
            progress: 0.0,
            message: message.into(),
            error: None,
            result: None,
            created_at: now(),
            updated_at: now(),
        };
        let mut jobs = self.jobs.lock();
        jobs.insert(0, job.clone());
        jobs.truncate(200);
        drop(jobs);
        self.cancels.lock().insert(job.id.clone(), Flag::default());
        self.emit(json!({"type": "job", "job": job}));
        job
    }

    pub fn update_job(&self, id: &str, f: impl FnOnce(&mut Job)) -> Option<Job> {
        let updated = {
            let mut jobs = self.jobs.lock();
            let job = jobs.iter_mut().find(|j| j.id == id)?;
            f(job);
            job.updated_at = now();
            job.clone()
        };
        if matches!(updated.status.as_str(), "succeeded" | "failed" | "cancelled") {
            self.cancels.lock().remove(id);
        }
        self.emit(json!({"type": "job", "job": updated}));
        Some(updated)
    }

    pub fn job(&self, id: &str) -> Option<Job> {
        self.jobs.lock().iter().find(|j| j.id == id).cloned()
    }

    pub fn cancel_flag(&self, id: &str) -> Flag {
        self.cancels.lock().get(id).cloned().unwrap_or_default()
    }

    pub fn active_job_for(&self, target_id: &str) -> Option<Job> {
        self.jobs
            .lock()
            .iter()
            .find(|j| j.target_id == target_id && matches!(j.status.as_str(), "queued" | "running"))
            .cloned()
    }
}
