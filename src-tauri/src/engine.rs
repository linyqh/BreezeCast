use crate::types::Params;
use anyhow::{Context, Result, anyhow, bail};
use futures::{Stream, StreamExt};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub const MODEL_ID: &str = "breeze";

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub state: String,
    pub message: String,
    pub backend: String,
    pub port: u16,
}

pub struct EngineConfig {
    pub binary: PathBuf,
    pub work_dir: PathBuf,
    pub model_path: Option<PathBuf>,
    pub bf16_activations: String,
    pub keep_model_loaded: bool,
}

#[derive(Debug, Clone, Default)]
pub struct SpeechRequest {
    pub text: String,
    pub instruct: String,
    pub ref_path: Option<String>,
    pub ref_text: Option<String>,
    pub params: Params,
}

pub struct Engine {
    status: Mutex<EngineStatus>,
    child: tokio::sync::Mutex<Option<Child>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    http: reqwest::Client,
    backend: tokio::sync::OnceCell<String>,
    /// audio.cpp runs one request per model; we serialize here so callers queue instead of hitting 503.
    pub busy: tokio::sync::Mutex<()>,
    on_change: Box<dyn Fn(&EngineStatus) + Send + Sync>,
}

impl Engine {
    pub fn new(on_change: impl Fn(&EngineStatus) + Send + Sync + 'static) -> Engine {
        Engine {
            status: Mutex::new(EngineStatus {
                state: "stopped".into(),
                message: String::new(),
                backend: String::new(),
                port: 0,
            }),
            child: tokio::sync::Mutex::new(None),
            logs: Arc::new(Mutex::new(VecDeque::new())),
            http: reqwest::Client::builder().pool_idle_timeout(Duration::from_secs(30)).build().unwrap(),
            backend: tokio::sync::OnceCell::new(),
            busy: tokio::sync::Mutex::new(()),
            on_change: Box::new(on_change),
        }
    }

    pub fn status(&self) -> EngineStatus {
        self.status.lock().clone()
    }

    fn set_status(&self, state: &str, message: impl Into<String>, port: Option<u16>) {
        let snapshot = {
            let mut s = self.status.lock();
            s.state = state.into();
            s.message = message.into();
            if let Some(p) = port {
                s.port = p;
            }
            s.clone()
        };
        (self.on_change)(&snapshot);
    }

    pub fn logs(&self, n: usize) -> Vec<String> {
        let l = self.logs.lock();
        l.iter().skip(l.len().saturating_sub(n)).cloned().collect()
    }

    fn push_log(logs: &Mutex<VecDeque<String>>, line: String) {
        let mut l = logs.lock();
        if l.len() >= 2000 {
            l.pop_front();
        }
        l.push_back(line);
    }

    pub async fn stop(&self) {
        let mut child = self.child.lock().await;
        if let Some(mut c) = child.take() {
            let _ = c.kill().await;
        }
        self.set_status("stopped", "", Some(0));
    }

    pub async fn start(self: &Arc<Self>, cfg: EngineConfig) -> Result<()> {
        self.stop().await;
        let Some(model_path) = cfg.model_path.filter(|p| p.exists()) else {
            self.set_status("no_model", "尚未安装 BreezeTTS 2 模型", Some(0));
            return Ok(());
        };
        if !cfg.binary.exists() {
            self.set_status("error", format!("找不到推理引擎 {}", cfg.binary.display()), Some(0));
            bail!("engine binary missing");
        }
        kill_stale(&cfg.work_dir);
        let backend = self.backend.get_or_init(|| detect_backend(&cfg.binary)).await.clone();
        self.status.lock().backend = backend.clone();
        let port = free_port()?;
        let config = json!({
            "host": "127.0.0.1",
            "port": port,
            "backend": backend,
            "threads": threads_for(&backend),
            "lazy_load": !cfg.keep_model_loaded,
            "idle_unload_ms": if cfg.keep_model_loaded { 0 } else { 600_000 },
            "max_loaded_models": 1,
            "busy_timeout_ms": 0,
            "ui": false,
            "models": [{
                "id": MODEL_ID,
                "family": "breeze_tts",
                "path": model_path,
                "task": "tts",
                "mode": "streaming",
                "session_options": {
                    "breeze_tts.bf16_activations": cfg.bf16_activations,
                    "breeze_tts.reference_cache_slots": 4
                }
            }]
        });
        std::fs::create_dir_all(&cfg.work_dir)?;
        let config_path = cfg.work_dir.join("server.json");
        std::fs::write(&config_path, serde_json::to_vec_pretty(&config)?)?;
        self.set_status("starting", "正在加载模型…", Some(port));
        let mut child = engine_command(&cfg.binary)
            .arg("--config")
            .arg(&config_path)
            .arg("--log")
            .arg("--no-ui")
            .current_dir(&cfg.work_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("spawn audiocpp_server")?;
        if let Some(pid) = child.id() {
            let _ = std::fs::write(cfg.work_dir.join("engine.pid"), pid.to_string());
        }
        for pipe in [child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
                     child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)]
            .into_iter()
            .flatten()
        {
            let logs = self.logs.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(pipe).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    Engine::push_log(&logs, line);
                }
            });
        }
        *self.child.lock().await = Some(child);

        let me = self.clone();
        tokio::spawn(async move {
            let url = format!("http://127.0.0.1:{port}/health");
            for _ in 0..600 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if me.status().port != port {
                    return;
                }
                if let Some(code) = me.exited().await {
                    let tail = me.logs(6).join("\n");
                    me.set_status("error", format!("引擎退出（{code}）\n{tail}"), None);
                    return;
                }
                if let Ok(r) = me.http.get(&url).timeout(Duration::from_secs(2)).send().await
                    && r.status().is_success()
                {
                    me.set_status("ready", "", None);
                    me.watch(port).await;
                    return;
                }
            }
            me.set_status("error", "引擎启动超时", None);
        });
        Ok(())
    }

    async fn exited(&self) -> Option<String> {
        let mut child = self.child.lock().await;
        match child.as_mut().map(|c| c.try_wait()) {
            Some(Ok(Some(code))) => Some(code.to_string()),
            _ => None,
        }
    }

    async fn watch(&self, port: u16) {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if self.status().port != port {
                return;
            }
            if let Some(code) = self.exited().await {
                let tail = self.logs(6).join("\n");
                self.set_status("error", format!("引擎意外退出（{code}）\n{tail}"), None);
                return;
            }
        }
    }

    fn base(&self) -> Result<String> {
        let s = self.status();
        if s.state != "ready" {
            return Err(anyhow!(match s.state.as_str() {
                "no_model" => "engine_no_model: 尚未安装模型，请先在“模型与引擎”中下载".to_string(),
                "starting" => "engine_starting: 引擎正在加载模型，请稍候".to_string(),
                _ => format!("engine_unavailable: 引擎未就绪（{}）", s.state),
            }));
        }
        Ok(format!("http://127.0.0.1:{}", s.port))
    }

    fn body(req: &SpeechRequest, stream: bool) -> Value {
        let p = &req.params;
        let mut options = serde_json::Map::new();
        if !req.instruct.trim().is_empty() {
            options.insert("instruct".into(), json!(req.instruct.trim()));
        }
        let guidance = p.guidance_scale.unwrap_or(if req.instruct.trim().is_empty() { 1.0 } else { 4.0 });
        options.insert("guidance_scale".into(), json!(guidance));
        macro_rules! opt {
            ($f:ident) => {
                if let Some(v) = &p.$f {
                    options.insert(stringify!($f).into(), json!(v));
                }
            };
        }
        opt!(temperature);
        opt!(depth_temperature);
        opt!(top_k);
        opt!(top_p);
        opt!(seed);
        opt!(max_tokens);
        opt!(text_chunk_size);
        opt!(text_chunk_mode);
        if stream {
            options.insert("stream_chunk_policy".into(), json!("fixed"));
            options.insert("stream_frames_per_event".into(), json!(8));
            options.insert("stream_lookahead_margin".into(), json!(0));
        }
        let mut body = json!({ "model": MODEL_ID, "input": req.text, "options": options });
        if let Some(path) = &req.ref_path {
            body["voice_ref"] = json!({"type": "path", "path": path});
            body["reference_text"] = json!(req.ref_text.clone().unwrap_or_default());
        }
        if stream {
            body["stream"] = json!(true);
            body["stream_format"] = json!("sse");
            body["response_format"] = json!("pcm");
        }
        body
    }

    async fn error_of(resp: reqwest::Response) -> anyhow::Error {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from).or_else(|| v["error"].as_str().map(String::from)))
            .unwrap_or(text);
        anyhow!("engine_error: 引擎返回 {code}: {msg}")
    }

    /// Returns WAV bytes. Caller must hold `busy`.
    pub async fn synthesize(&self, req: &SpeechRequest) -> Result<Vec<u8>> {
        let resp = self
            .http
            .post(format!("{}/v1/audio/speech", self.base()?))
            .json(&Self::body(req, false))
            .send()
            .await
            .context("engine_unavailable: 无法连接推理引擎")?;
        if !resp.status().is_success() {
            return Err(Self::error_of(resp).await);
        }
        Ok(resp.bytes().await?.to_vec())
    }

    /// Yields base64 PCM16 chunks. Caller must hold `busy` for the lifetime of the stream.
    pub async fn stream(&self, req: &SpeechRequest) -> Result<impl Stream<Item = Result<String>> + use<>> {
        let resp = self
            .http
            .post(format!("{}/v1/audio/speech", self.base()?))
            .header("Accept", "text/event-stream")
            .json(&Self::body(req, true))
            .send()
            .await
            .context("engine_unavailable: 无法连接推理引擎")?;
        if !resp.status().is_success() {
            return Err(Self::error_of(resp).await);
        }
        let mut bytes = resp.bytes_stream();
        Ok(async_stream::try_stream! {
            let mut buf = String::new();
            while let Some(chunk) = bytes.next().await {
                buf.push_str(&String::from_utf8_lossy(&chunk?));
                while let Some(pos) = buf.find("\n\n") {
                    let event: String = buf.drain(..pos + 2).collect();
                    for line in event.lines() {
                        let Some(data) = line.strip_prefix("data:") else { continue };
                        let data = data.trim();
                        if data == "[DONE]" { continue; }
                        let v: Value = serde_json::from_str(data)?;
                        match v["type"].as_str() {
                            Some("speech.audio.delta") => {
                                if let Some(a) = v["audio"].as_str() { yield a.to_string(); }
                            }
                            Some("error") | Some("speech.error") => {
                                Err(anyhow!("engine_error: {}", v["error"]["message"].as_str().or(v["message"].as_str()).unwrap_or("stream failed")))?;
                            }
                            _ => {}
                        }
                    }
                }
            }
        })
    }
}

fn free_port() -> Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The sidecar is a console program; on Windows it would otherwise pop up a console window.
fn engine_command(binary: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(binary);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// audio.cpp has no automatic backend fallback, so pick the best device the build can see.
async fn detect_backend(binary: &Path) -> String {
    if cfg!(target_os = "macos") {
        return "metal".into();
    }
    let probe = engine_command(binary).args(["--list-devices", "--json"]).kill_on_drop(true).output();
    let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(60), probe).await else {
        return "cpu".into();
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let devices: Vec<Value> = stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<Value>(l).ok())
        .and_then(|v| v["devices"].as_array().cloned())
        .unwrap_or_default();
    ["cuda", "vulkan"]
        .into_iter()
        .find(|want| {
            devices.iter().any(|d| d["backend"] == *want && matches!(d["type"].as_str(), Some("gpu" | "igpu")))
        })
        .unwrap_or("cpu")
        .into()
}

fn threads_for(backend: &str) -> usize {
    if backend != "cpu" {
        return 4;
    }
    let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (logical / 2).max(logical.min(4))
}

/// Kills an engine left behind by a crashed previous app instance.
fn kill_stale(work_dir: &Path) {
    let pid_file = work_dir.join("engine.pid");
    if let Some(pid) = std::fs::read_to_string(&pid_file).ok().and_then(|p| p.trim().parse::<u32>().ok()) {
        kill_if_engine(pid);
    }
    let _ = std::fs::remove_file(pid_file);
}

#[cfg(unix)]
fn kill_if_engine(pid: u32) {
    let pid = pid.to_string();
    let out = std::process::Command::new("/bin/ps").args(["-p", &pid, "-o", "comm="]).output();
    if let Ok(o) = out
        && String::from_utf8_lossy(&o.stdout).contains("audiocpp_server")
    {
        let _ = std::process::Command::new("/bin/kill").arg(&pid).status();
    }
}

#[cfg(windows)]
fn kill_if_engine(pid: u32) {
    use std::os::windows::process::CommandExt;
    let filter = format!("PID eq {pid}");
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &filter, "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    if let Ok(o) = out
        && String::from_utf8_lossy(&o.stdout).contains("audiocpp_server")
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}
