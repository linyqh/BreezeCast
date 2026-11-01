use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Params {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidance_scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_chunk_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_chunk_mode: Option<String>,
}

impl Params {
    /// Fields set in `top` win over `self`.
    pub fn overlay(&self, top: &Params) -> Params {
        Params {
            guidance_scale: top.guidance_scale.or(self.guidance_scale),
            temperature: top.temperature.or(self.temperature),
            depth_temperature: top.depth_temperature.or(self.depth_temperature),
            top_k: top.top_k.or(self.top_k),
            top_p: top.top_p.or(self.top_p),
            seed: top.seed.or(self.seed),
            max_tokens: top.max_tokens.or(self.max_tokens),
            text_chunk_size: top.text_chunk_size.or(self.text_chunk_size),
            text_chunk_mode: top.text_chunk_mode.clone().or_else(|| self.text_chunk_mode.clone()),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        let pos = |v: Option<f64>, n: &str| match v {
            Some(x) if !(x.is_finite() && x > 0.0) => Err(format!("{n} must be > 0")),
            _ => Ok(()),
        };
        pos(self.temperature, "temperature")?;
        pos(self.depth_temperature, "depth_temperature")?;
        pos(self.top_p, "top_p")?;
        if let Some(g) = self.guidance_scale
            && !(g.is_finite() && g >= 0.0)
        {
            return Err("guidance_scale must be >= 0".into());
        }
        if matches!(self.max_tokens, Some(x) if x <= 0) {
            return Err("max_tokens must be > 0".into());
        }
        if matches!(self.text_chunk_size, Some(x) if x <= 0) {
            return Err("text_chunk_size must be > 0".into());
        }
        if let Some(m) = &self.text_chunk_mode
            && !["default", "tag_aware", "endline"].contains(&m.as_str())
        {
            return Err("text_chunk_mode must be default, tag_aware or endline".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "auto_lang")]
    pub language: String,
    pub source: String,
    #[serde(default)]
    pub instruct: String,
    pub ref_text: Option<String>,
    pub ref_path: Option<String>,
    #[serde(default)]
    pub params: Params,
    #[serde(default = "default_color")]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn auto_lang() -> String {
    "auto".into()
}
pub fn default_color() -> String {
    "#0A84FF".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub text: String,
    pub instruct: String,
    pub voice_id: Option<String>,
    pub params: Params,
    pub seed: u64,
    pub duration_ms: u64,
    pub path: String,
    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Show {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default = "auto_lang")]
    pub language: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CastMember {
    pub speaker: String,
    pub voice_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LineAudio {
    pub path: String,
    pub duration_ms: u64,
    pub hash: String,
    pub seed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Line {
    pub id: String,
    pub speaker: String,
    pub text: String,
    #[serde(default)]
    pub direction: String,
    #[serde(default = "default_pause")]
    pub pause_ms: u64,
    #[serde(default)]
    pub params: Option<Params>,
    #[serde(default)]
    pub audio: Option<LineAudio>,
}

pub fn default_pause() -> u64 {
    400
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeAudio {
    pub path: String,
    pub duration_ms: u64,
    pub rendered_at: String,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub line_id: String,
    pub speaker: String,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub show_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "auto_lang")]
    pub language: String,
    #[serde(default)]
    pub cast: Vec<CastMember>,
    #[serde(default)]
    pub lines: Vec<Line>,
    #[serde(default)]
    pub params: Params,
    #[serde(default)]
    pub audio: Option<EpisodeAudio>,
    #[serde(default)]
    pub failed: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub target_id: String,
    pub status: String,
    pub progress: f64,
    pub message: String,
    pub error: Option<String>,
    pub result: Option<Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub active_package: String,
    pub bf16_activations: String,
    #[serde(default)]
    pub default_params: Params,
    pub api_port: u16,
    pub keep_model_loaded: bool,
    #[serde(default)]
    pub export_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            active_package: "breeze_tts_2_q8_0".into(),
            bf16_activations: "on".into(),
            default_params: Params::default(),
            api_port: 17860,
            keep_model_loaded: true,
            export_dir: None,
        }
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id(prefix: &str) -> String {
    let u = uuid::Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &u[..12])
}
