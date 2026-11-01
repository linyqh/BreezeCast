use anyhow::{Context, Result, bail};
use std::path::Path;
use std::process::Command;

pub const SAMPLE_RATE: u32 = 24_000;

pub fn read_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    let mut reader = hound::WavReader::open(path).with_context(|| format!("open wav {}", path.display()))?;
    let spec = reader.spec();
    let ch = spec.channels.max(1) as usize;
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / scale))
                .collect::<Result<_, _>>()?
        }
    };
    let mono = if ch == 1 {
        interleaved
    } else {
        interleaved.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect()
    };
    Ok((mono, spec.sample_rate))
}

pub fn read_mono_24k(path: &Path) -> Result<Vec<f32>> {
    let (s, sr) = read_mono(path)?;
    Ok(resample_linear(&s, sr, SAMPLE_RATE))
}

pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = input[idx.min(input.len() - 1)];
            let b = input[(idx + 1).min(input.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

pub fn write_pcm16(path: &Path, samples: &[f32], sample_rate: u32) -> Result<()> {
    let spec = hound::WavSpec { channels: 1, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec)?;
    for s in samples {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0).round() as i16)?;
    }
    w.finalize()?;
    Ok(())
}

pub fn duration_ms(path: &Path) -> Result<u64> {
    let r = hound::WavReader::open(path)?;
    let spec = r.spec();
    Ok(r.duration() as u64 * 1000 / spec.sample_rate as u64)
}

/// Brings speech to a consistent loudness: RMS of voiced samples to -20 dBFS, peaks capped at -1 dBFS.
pub fn normalize_speech(samples: &mut [f32]) {
    let voiced: Vec<f32> = samples.iter().copied().filter(|s| s.abs() > 0.01).collect();
    if voiced.is_empty() {
        return;
    }
    let rms = (voiced.iter().map(|s| s * s).sum::<f32>() / voiced.len() as f32).sqrt();
    let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
    let target_rms = 10f32.powf(-20.0 / 20.0);
    let ceiling = 10f32.powf(-1.0 / 20.0);
    let gain = (target_rms / rms).min(ceiling / peak.max(1e-6)).min(8.0);
    for s in samples.iter_mut() {
        *s *= gain;
    }
}

fn fade(samples: &mut [f32], len: usize) {
    let n = len.min(samples.len() / 2);
    for i in 0..n {
        let g = i as f32 / n as f32;
        samples[i] *= g;
        let j = samples.len() - 1 - i;
        samples[j] *= g;
    }
}

pub struct Segment<'a> {
    pub path: &'a Path,
    pub pause_ms: u64,
}

/// Concatenates segments with trailing pauses; returns samples and (start_ms, end_ms) for each segment.
pub fn stitch(segments: &[Segment]) -> Result<(Vec<f32>, Vec<(u64, u64)>)> {
    let mut out: Vec<f32> = Vec::new();
    let mut spans = Vec::with_capacity(segments.len());
    let lead = (SAMPLE_RATE as usize) / 4;
    out.resize(lead, 0.0);
    for (i, seg) in segments.iter().enumerate() {
        let mut s = read_mono_24k(seg.path)?;
        normalize_speech(&mut s);
        fade(&mut s, SAMPLE_RATE as usize / 200);
        let start = out.len() as u64 * 1000 / SAMPLE_RATE as u64;
        out.extend_from_slice(&s);
        let end = out.len() as u64 * 1000 / SAMPLE_RATE as u64;
        spans.push((start, end));
        let pause = if i + 1 == segments.len() { 600 } else { seg.pause_ms };
        out.resize(out.len() + (pause as usize * SAMPLE_RATE as usize / 1000), 0.0);
    }
    Ok((out, spans))
}

/// Converts any CoreAudio-readable file (wav, mp3, m4a, aiff, caf, flac) to 24 kHz mono PCM16 WAV.
pub fn convert_to_wav(input: &Path, output: &Path) -> Result<()> {
    let status = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@24000", "-c", "1"])
        .arg(input)
        .arg(output)
        .status()
        .context("run afconvert")?;
    if !status.success() {
        bail!("unsupported or corrupt audio file");
    }
    Ok(())
}

pub fn encode_m4a(input: &Path, output: &Path) -> Result<()> {
    let status = Command::new("/usr/bin/afconvert")
        .args(["-f", "m4af", "-d", "aac", "-b", "128000", "-q", "127", "-s", "3"])
        .arg(input)
        .arg(output)
        .status()
        .context("run afconvert")?;
    if !status.success() {
        bail!("AAC encoding failed");
    }
    Ok(())
}
