use anyhow::{Context, Result, bail};
use std::path::Path;

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

/// Converts wav, mp3, m4a/aac, alac, flac, aiff, caf or ogg to 24 kHz mono PCM16 WAV.
pub fn convert_to_wav(input: &Path, output: &Path) -> Result<()> {
    let (samples, rate) = decode_mono(input).context("unsupported or corrupt audio file")?;
    write_pcm16(output, &resample(&samples, rate, SAMPLE_RATE)?, SAMPLE_RATE)
}

fn decode_mono(path: &Path) -> Result<(Vec<f32>, u32)> {
    use symphonia::core::codecs::audio::AudioDecoderOptions;
    use symphonia::core::errors::Error;
    use symphonia::core::formats::probe::Hint;
    use symphonia::core::formats::{FormatOptions, TrackType};
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;

    let mss = MediaSourceStream::new(Box::new(std::fs::File::open(path)?), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format =
        symphonia::default::get_probe().probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())?;
    let track = format.default_track(TrackType::Audio).context("no audio track")?;
    let track_id = track.id;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).context("no audio track")?;
    let mut decoder = symphonia::default::get_codecs().make_audio_decoder(params, &AudioDecoderOptions::default())?;
    let (mut mono, mut rate, mut frame) = (Vec::new(), 0, Vec::<f32>::new());
    while let Some(packet) = format.next_packet()? {
        if packet.track_id != track_id {
            continue;
        }
        let buf = match decoder.decode(&packet) {
            Ok(b) => b,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        rate = buf.spec().rate();
        let ch = buf.spec().channels().count().max(1);
        frame.resize(buf.samples_interleaved(), 0.0);
        buf.copy_to_slice_interleaved(&mut frame);
        mono.extend(frame.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32));
    }
    if mono.is_empty() || rate == 0 {
        bail!("no audio samples");
    }
    Ok((mono, rate))
}

/// Band-limited resampling, so 44.1/48 kHz sources don't alias when brought down to 24 kHz.
pub fn resample(input: &[f32], from: u32, to: u32) -> Result<Vec<f32>> {
    use rubato::audioadapter_buffers::direct::InterleavedSlice;
    use rubato::{Fft, FixedSync, Resampler};
    if from == to || input.is_empty() {
        return Ok(input.to_vec());
    }
    let mut r = Fft::<f32>::new(from as usize, to as usize, 1024, 1, FixedSync::Input)?;
    let buf = InterleavedSlice::new(input, 1, input.len())?;
    Ok(r.process_all(&buf, input.len(), None)?.take_data())
}

#[cfg(not(windows))]
pub fn encode_m4a(input: &Path, output: &Path) -> Result<()> {
    let status = std::process::Command::new("/usr/bin/afconvert")
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

/// AAC-LC 128 kbps via Media Foundation, whose encoder only accepts 44.1/48 kHz input.
#[cfg(windows)]
pub fn encode_m4a(input: &Path, output: &Path) -> Result<()> {
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
    use windows::core::HSTRING;

    const RATE: u32 = 48_000;
    let (mono, sr) = read_mono(input)?;
    let pcm: Vec<i16> =
        resample(&mono, sr, RATE)?.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16).collect();

    let audio_type = |subtype: &windows::core::GUID| -> windows::core::Result<IMFMediaType> {
        let t = unsafe { MFCreateMediaType()? };
        unsafe {
            t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
            t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
            t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
            t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, RATE)?;
            t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1)?;
        }
        Ok(t)
    };
    let write = || -> windows::core::Result<()> {
        unsafe {
            let writer = MFCreateSinkWriterFromURL(&HSTRING::from(output.as_os_str()), None, None)?;
            let out = audio_type(&MFAudioFormat_AAC)?;
            out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16_000)?;
            let stream = writer.AddStream(&out)?;
            let inp = audio_type(&MFAudioFormat_PCM)?;
            inp.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2)?;
            inp.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, RATE * 2)?;
            writer.SetInputMediaType(stream, &inp, None)?;
            writer.BeginWriting()?;
            let mut written: i64 = 0;
            for chunk in pcm.chunks(RATE as usize) {
                let bytes = (chunk.len() * 2) as u32;
                let buffer = MFCreateMemoryBuffer(bytes)?;
                let mut ptr = std::ptr::null_mut();
                buffer.Lock(&mut ptr, None, None)?;
                std::ptr::copy_nonoverlapping(chunk.as_ptr().cast::<u8>(), ptr, bytes as usize);
                buffer.Unlock()?;
                buffer.SetCurrentLength(bytes)?;
                let sample = MFCreateSample()?;
                sample.AddBuffer(&buffer)?;
                sample.SetSampleTime(written * 10_000_000 / RATE as i64)?;
                sample.SetSampleDuration(chunk.len() as i64 * 10_000_000 / RATE as i64)?;
                writer.WriteSample(stream, &sample)?;
                written += chunk.len() as i64;
            }
            writer.Finalize()
        }
    };

    let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let result = unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) }.and_then(|()| {
        let r = write();
        let _ = unsafe { MFShutdown() };
        r
    });
    if com.is_ok() {
        unsafe { CoUninitialize() };
    }
    result.context("AAC encoding failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: u32, secs: f32) -> Vec<f32> {
        (0..(rate as f32 * secs) as usize).map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.5).collect()
    }

    #[test]
    fn import_downmixes_and_resamples_to_24k() {
        let dir = std::env::temp_dir().join(format!("bc-audio-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("stereo48k.wav");
        let spec = hound::WavSpec { channels: 2, sample_rate: 48_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&src, spec).unwrap();
        for s in tone(48_000, 3.0) {
            let v = (s * 32767.0) as i16;
            w.write_sample(v).unwrap();
            w.write_sample(v).unwrap();
        }
        w.finalize().unwrap();
        let out = dir.join("out.wav");
        convert_to_wav(&src, &out).unwrap();
        let r = hound::WavReader::open(&out).unwrap();
        assert_eq!((r.spec().channels, r.spec().sample_rate), (1, 24_000));
        assert!((duration_ms(&out).unwrap() as i64 - 3000).abs() <= 20);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn m4a_export_round_trips() {
        let dir = std::env::temp_dir().join(format!("bc-m4a-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("in.wav");
        write_pcm16(&wav, &tone(SAMPLE_RATE, 2.5), SAMPLE_RATE).unwrap();
        let m4a = dir.join("out.m4a");
        encode_m4a(&wav, &m4a).unwrap();
        let back = dir.join("back.wav");
        convert_to_wav(&m4a, &back).unwrap();
        let ms = duration_ms(&back).unwrap();
        // AAC priming (~2112 frames) may or may not be trimmed by the decoder.
        assert!((2450..=2700).contains(&ms), "round-trip duration {ms} ms");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
