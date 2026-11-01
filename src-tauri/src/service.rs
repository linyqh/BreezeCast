use crate::audio;
use crate::engine::SpeechRequest;
use crate::state::{RenderTask, Shared};
use crate::types::*;
use anyhow::{Context, Result, anyhow, bail};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const VOCAL_EVENTS_EN: [&str; 4] = ["(laugh)", "(cough)", "(clears throat)", "(sigh)"];
pub const VOCAL_EVENTS_ZH: [&str; 4] = ["[笑]", "[咳嗽]", "[清嗓子]", "[叹气]"];

/// Removes vocal-event tags so a take's text can serve as an exact reference transcript.
pub fn strip_events(text: &str) -> String {
    let mut t = text.to_string();
    for e in VOCAL_EVENTS_EN.iter().chain(VOCAL_EVENTS_ZH.iter()) {
        t = t.replace(e, "");
    }
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn random_seed() -> u64 {
    rand::random::<u32>() as u64
}

pub fn voice(state: &Shared, id: &str) -> Result<Voice> {
    state.db.get::<Voice>("voices", id)?.ok_or_else(|| anyhow!("not_found: 声音 {id} 不存在"))
}

pub fn episode(state: &Shared, id: &str) -> Result<Episode> {
    state.db.get::<Episode>("episodes", id)?.ok_or_else(|| anyhow!("not_found: 单集 {id} 不存在"))
}

pub fn save_episode(state: &Shared, ep: &mut Episode) -> Result<()> {
    ep.updated_at = now();
    state.db.put("episodes", &ep.id, &ep.created_at, ep)?;
    state.emit(json!({"type": "episode", "episode_id": ep.id}));
    Ok(())
}

/// How a voice + direction becomes a model request (see docs/API.md).
pub fn build_request(text: &str, voice: Option<&Voice>, direction: &str, layers: &[&Params]) -> SpeechRequest {
    let mut params = Params::default();
    for p in layers {
        params = params.overlay(p);
    }
    let direction = direction.trim();
    let (instruct, ref_path, ref_text) = match voice {
        Some(v) if v.ref_path.is_some() => {
            let instruct = if direction.is_empty() { v.instruct.clone() } else { direction.to_string() };
            (instruct, v.ref_path.clone(), v.ref_text.clone())
        }
        Some(v) => {
            let instruct = [v.instruct.trim(), direction].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(" ");
            (instruct, None, None)
        }
        None => (direction.to_string(), None, None),
    };
    SpeechRequest { text: text.trim().to_string(), instruct, ref_path, ref_text, params }
}

/// Identity of a take excluding the seed when the seed was not pinned by the user.
fn request_hash(state: &Shared, req: &SpeechRequest, voice: Option<&Voice>) -> String {
    let s = state.settings();
    let mut p = req.params.clone();
    p.seed = None;
    let v = json!({
        "text": req.text, "instruct": req.instruct, "has_ref": req.ref_path.is_some(), "ref_text": req.ref_text,
        "voice": voice.map(|v| (v.id.clone(), v.updated_at.clone())), "params": p,
        "package": s.active_package, "bf16": s.bf16_activations,
    });
    hex::encode(Sha256::digest(v.to_string().as_bytes()))[..16].to_string()
}

pub async fn synthesize_to(state: &Shared, req: &SpeechRequest, out: &Path) -> Result<u64> {
    let _guard = state.engine.busy.lock().await;
    let wav = state.engine.synthesize(req).await?;
    tokio::fs::write(out, &wav).await?;
    audio::duration_ms(out)
}

pub async fn speak(state: &Shared, mut req: SpeechRequest, voice_id: Option<String>, kind: &str) -> Result<Clip> {
    if req.text.trim().is_empty() {
        bail!("invalid_request: text 不能为空");
    }
    req.params.validate().map_err(|e| anyhow!("invalid_request: {e}"))?;
    let seed = *req.params.seed.get_or_insert_with(random_seed);
    let id = new_id("c");
    let path = state.paths.clips.join(format!("{id}.wav"));
    let duration_ms = synthesize_to(state, &req, &path).await?;
    let clip = Clip {
        id: id.clone(),
        text: req.text.clone(),
        instruct: req.instruct.clone(),
        voice_id,
        params: req.params.clone(),
        seed,
        duration_ms,
        path: path.to_string_lossy().into(),
        kind: kind.into(),
        created_at: now(),
    };
    state.db.put("clips", &id, &clip.created_at, &clip)?;
    Ok(clip)
}

pub fn save_stream_clip(state: &Shared, req: &SpeechRequest, voice_id: Option<String>, pcm: &[i16]) -> Result<Clip> {
    let id = new_id("c");
    let path = state.paths.clips.join(format!("{id}.wav"));
    let samples: Vec<f32> = pcm.iter().map(|s| *s as f32 / 32768.0).collect();
    audio::write_pcm16(&path, &samples, audio::SAMPLE_RATE)?;
    let clip = Clip {
        id: id.clone(),
        text: req.text.clone(),
        instruct: req.instruct.clone(),
        voice_id,
        params: req.params.clone(),
        seed: req.params.seed.unwrap_or_default(),
        duration_ms: samples.len() as u64 * 1000 / audio::SAMPLE_RATE as u64,
        path: path.to_string_lossy().into(),
        kind: "speech".into(),
        created_at: now(),
    };
    state.db.put("clips", &id, &clip.created_at, &clip)?;
    Ok(clip)
}

/// Imports reference audio (wav/mp3/m4a/flac/aiff/caf/ogg) as a 24 kHz mono WAV and checks its length.
pub fn import_reference(state: &Shared, src: &Path, dest: &Path) -> Result<u64> {
    let tmp = state.paths.tmp.join(format!("{}.wav", new_id("ref")));
    audio::convert_to_wav(src, &tmp)?;
    let ms = audio::duration_ms(&tmp)?;
    if ms < 2_000 || ms > 40_000 {
        let _ = std::fs::remove_file(&tmp);
        bail!("invalid_audio: 参考音频时长为 {:.1} 秒，请使用 3–20 秒的干净人声", ms as f64 / 1000.0);
    }
    std::fs::rename(&tmp, dest)?;
    Ok(ms)
}

// ---------- episodes ----------

pub fn cast_voice(state: &Shared, ep: &Episode, speaker: &str) -> Option<Voice> {
    let id = &ep.cast.iter().find(|c| c.speaker == speaker)?.voice_id;
    state.db.get::<Voice>("voices", id).ok().flatten()
}

pub fn line_request(state: &Shared, ep: &Episode, line: &Line) -> Result<(SpeechRequest, Option<Voice>)> {
    let voice = cast_voice(state, ep, &line.speaker);
    if voice.is_none() {
        bail!("cast_missing: 角色“{}”还没有分配声音", line.speaker);
    }
    let defaults = state.settings().default_params;
    let empty = Params::default();
    let req = build_request(
        &line.text,
        voice.as_ref(),
        &line.direction,
        &[&defaults, &ep.params, voice.as_ref().map(|v| &v.params).unwrap_or(&empty), line.params.as_ref().unwrap_or(&empty)],
    );
    Ok((req, voice))
}

/// `None` if the line cannot be rendered (e.g. no voice).
pub fn line_hash(state: &Shared, ep: &Episode, line: &Line) -> Option<String> {
    let (req, voice) = line_request(state, ep, line).ok()?;
    Some(request_hash(state, &req, voice.as_ref()))
}

pub fn line_is_stale(state: &Shared, ep: &Episode, line: &Line) -> bool {
    match &line.audio {
        None => true,
        Some(a) => Some(&a.hash) != line_hash(state, ep, line).as_ref() || !Path::new(&a.path).exists(),
    }
}

fn line_dir(state: &Shared, ep_id: &str) -> PathBuf {
    let d = state.paths.episodes.join(ep_id).join("lines");
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Renders one line; a forced re-render picks a new seed unless the seed is pinned.
pub async fn render_line(state: &Shared, ep: &Episode, line: &Line, force: bool) -> Result<LineAudio> {
    let (mut req, voice) = line_request(state, ep, line)?;
    if req.text.is_empty() {
        bail!("invalid_request: 第 {} 行没有文本", ep.lines.iter().position(|l| l.id == line.id).unwrap_or(0) + 1);
    }
    let hash = request_hash(state, &req, voice.as_ref());
    if req.params.seed.is_none() && !force
        && let Some(a) = &line.audio
    {
        req.params.seed = Some(a.seed);
    }
    let seed = *req.params.seed.get_or_insert_with(random_seed);
    let path = line_dir(state, &ep.id).join(format!("{}-{}-{seed}.wav", line.id, &hash[..8]));
    let duration_ms = synthesize_to(state, &req, &path).await?;
    Ok(LineAudio { path: path.to_string_lossy().into(), duration_ms, hash, seed })
}

/// Writes the rendered take back onto the latest stored episode, unless the line was edited meanwhile.
pub fn store_line_audio(state: &Shared, ep_id: &str, line: &Line, audio: LineAudio) -> Result<Episode> {
    let mut ep = episode(state, ep_id)?;
    if let Some(l) = ep.lines.iter_mut().find(|l| l.id == line.id)
        && l.text == line.text
        && l.direction == line.direction
    {
        if let Some(old) = &l.audio
            && old.path != audio.path
        {
            let _ = std::fs::remove_file(&old.path);
        }
        l.audio = Some(audio);
    }
    save_episode(state, &mut ep)?;
    Ok(ep)
}

pub fn audio_signature(ep: &Episode) -> String {
    let parts: Vec<String> = ep
        .lines
        .iter()
        .map(|l| format!("{}:{}:{}", l.id, l.audio.as_ref().map(|a| a.path.as_str()).unwrap_or("-"), l.pause_ms))
        .collect();
    hex::encode(Sha256::digest(parts.join("|").as_bytes()))[..16].to_string()
}

pub fn episode_status(state: &Shared, ep: &Episode) -> &'static str {
    if state.active_job_for(&ep.id).is_some() {
        return "rendering";
    }
    if ep.failed.is_some() {
        return "failed";
    }
    let any_stale = ep.lines.iter().any(|l| line_is_stale(state, ep, l));
    match &ep.audio {
        Some(a) if !any_stale && a.rendered_at.ends_with(&audio_signature(ep)) => "rendered",
        Some(_) => "stale",
        None => "draft",
    }
}

pub fn stitch_episode(state: &Shared, ep: &mut Episode) -> Result<()> {
    let segs: Vec<audio::Segment> = ep
        .lines
        .iter()
        .map(|l| {
            l.audio
                .as_ref()
                .map(|a| audio::Segment { path: Path::new(&a.path), pause_ms: l.pause_ms })
                .ok_or_else(|| anyhow!("render_incomplete: 还有未生成的台词"))
        })
        .collect::<Result<_>>()?;
    if segs.is_empty() {
        bail!("invalid_request: 单集没有台词");
    }
    let (samples, spans) = audio::stitch(&segs)?;
    let path = state.paths.episodes.join(&ep.id).join("episode.wav");
    audio::write_pcm16(&path, &samples, audio::SAMPLE_RATE)?;
    let chapters = ep
        .lines
        .iter()
        .zip(spans)
        .map(|(l, (s, e))| Chapter { line_id: l.id.clone(), speaker: l.speaker.clone(), text: l.text.clone(), start_ms: s, end_ms: e })
        .collect();
    // rendered_at carries the line signature so later edits mark the mix stale.
    ep.audio = Some(EpisodeAudio {
        path: path.to_string_lossy().into(),
        duration_ms: samples.len() as u64 * 1000 / audio::SAMPLE_RATE as u64,
        rendered_at: format!("{}#{}", now(), audio_signature(ep)),
        chapters,
    });
    Ok(())
}

pub async fn run_render(state: Shared, task: RenderTask) {
    let RenderTask { job_id, episode_id, line_ids, force } = task;
    let cancel = state.cancel_flag(&job_id);
    state.update_job(&job_id, |j| {
        j.status = "running".into();
        j.message = "准备中".into();
    });
    let result: Result<Episode> = async {
        let ep = episode(&state, &episode_id)?;
        let targets: Vec<Line> = ep
            .lines
            .iter()
            .filter(|l| line_ids.as_ref().is_none_or(|ids| ids.contains(&l.id)))
            .filter(|l| force || line_is_stale(&state, &ep, l))
            .cloned()
            .collect();
        for l in &targets {
            line_request(&state, &ep, l)?;
        }
        let total = targets.len().max(1) as f64;
        for (i, line) in targets.iter().enumerate() {
            if cancel.is_set() {
                bail!("cancelled");
            }
            state.update_job(&job_id, |j| {
                j.progress = i as f64 / total * 0.95;
                j.message = format!("正在生成第 {}/{} 句 · {}", i + 1, targets.len(), line.speaker);
                j.result = Some(json!({"line_id": line.id}));
            });
            let ep_now = episode(&state, &episode_id)?;
            let audio = render_line(&state, &ep_now, line, force).await?;
            store_line_audio(&state, &episode_id, line, audio)?;
        }
        state.update_job(&job_id, |j| {
            j.progress = 0.97;
            j.message = "正在混音".into();
        });
        let mut ep = episode(&state, &episode_id)?;
        if ep.lines.iter().any(|l| line_is_stale(&state, &ep, l)) && line_ids.is_none() {
            bail!("render_incomplete: 渲染过程中台词被修改，请重新渲染");
        }
        if ep.lines.iter().all(|l| l.audio.is_some()) {
            stitch_episode(&state, &mut ep)?;
        }
        ep.failed = None;
        save_episode(&state, &mut ep)?;
        Ok(ep)
    }
    .await;
    match result {
        Ok(ep) => {
            state.update_job(&job_id, |j| {
                j.status = "succeeded".into();
                j.progress = 1.0;
                j.message = "完成".into();
                j.result = Some(json!({"episode_id": ep.id, "duration_ms": ep.audio.as_ref().map(|a| a.duration_ms)}));
            });
        }
        Err(e) => {
            let msg = format!("{e:#}");
            let cancelled = msg == "cancelled";
            if !cancelled && let Ok(mut ep) = episode(&state, &episode_id) {
                ep.failed = Some(msg.clone());
                let _ = save_episode(&state, &mut ep);
            }
            state.update_job(&job_id, |j| {
                j.status = if cancelled { "cancelled" } else { "failed" }.into();
                j.message = if cancelled { "已取消".into() } else { "失败".into() };
                j.error = (!cancelled).then_some(msg);
            });
        }
    }
}

// ---------- export ----------

fn ms_srt(ms: u64) -> String {
    format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
}

pub fn transcript(ep: &Episode, format: &str) -> Result<String> {
    let a = ep.audio.as_ref().ok_or_else(|| anyhow!("not_rendered: 单集尚未渲染"))?;
    Ok(match format {
        "srt" => a
            .chapters
            .iter()
            .enumerate()
            .map(|(i, c)| format!("{}\n{} --> {}\n{}: {}\n", i + 1, ms_srt(c.start_ms), ms_srt(c.end_ms), c.speaker, c.text))
            .collect::<Vec<_>>()
            .join("\n"),
        "txt" => a.chapters.iter().map(|c| format!("{}: {}", c.speaker, c.text)).collect::<Vec<_>>().join("\n\n"),
        _ => serde_json::to_string_pretty(&json!({"title": ep.title, "duration_ms": a.duration_ms, "chapters": a.chapters}))?,
    })
}

fn sanitize(name: &str) -> String {
    let s: String = name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '-' } else { c }).collect();
    let s = s.trim().to_string();
    if s.is_empty() { "Untitled".into() } else { s }
}

pub fn export(state: &Shared, ep: &Episode, format: &str, dir: Option<String>) -> Result<serde_json::Value> {
    let a = ep.audio.as_ref().ok_or_else(|| anyhow!("not_rendered: 单集尚未渲染"))?;
    let show_title = ep
        .show_id
        .as_ref()
        .and_then(|id| state.db.get::<Show>("shows", id).ok().flatten())
        .map(|s| s.title);
    let base = match dir.or(state.settings().export_dir) {
        Some(d) => PathBuf::from(d),
        None => {
            let mut p = std::env::home_dir().unwrap_or_else(std::env::temp_dir).join("Music").join("BreezeCast");
            if let Some(t) = &show_title {
                p = p.join(sanitize(t));
            }
            p
        }
    };
    std::fs::create_dir_all(&base).context("create export folder")?;
    let stem = sanitize(&ep.title);
    let audio_path = match format {
        "wav" => {
            let p = base.join(format!("{stem}.wav"));
            std::fs::copy(&a.path, &p)?;
            p
        }
        "m4a" => {
            let p = base.join(format!("{stem}.m4a"));
            let _ = std::fs::remove_file(&p);
            audio::encode_m4a(Path::new(&a.path), &p)?;
            p
        }
        other => bail!("invalid_request: 不支持的格式 {other}（可选 m4a / wav）"),
    };
    let srt = base.join(format!("{stem}.srt"));
    std::fs::write(&srt, transcript(ep, "srt")?)?;
    let chapters = base.join(format!("{stem}.chapters.json"));
    std::fs::write(&chapters, transcript(ep, "json")?)?;
    let txt = base.join(format!("{stem}.txt"));
    std::fs::write(&txt, transcript(ep, "txt")?)?;
    Ok(json!({
        "audio_path": audio_path, "srt_path": srt, "chapters_path": chapters, "transcript_path": txt, "dir": base
    }))
}
