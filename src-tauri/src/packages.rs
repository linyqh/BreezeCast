use anyhow::{Context, Result, bail};
use futures::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub struct Package {
    pub id: &'static str,
    pub precision: &'static str,
    pub file: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub label: &'static str,
}

pub const PACKAGES: [Package; 4] = [
    Package {
        id: "breeze_tts_2_q4_0",
        precision: "q4_0",
        file: "breeze-tts-2-q4_0.gguf",
        size: 3_794_800_192,
        sha256: "56b3cc598b1f9220b6fb23dc9eaa098a9a1d0cc6604298a76faac79eef4824b8",
        label: "最小体积，适合 16 GB 内存",
    },
    Package {
        id: "breeze_tts_2_q4_k",
        precision: "q4_k",
        file: "breeze-tts-2-q4_k.gguf",
        size: 4_459_531_840,
        sha256: "6d6cd66dc487c6843f8797e1e569ad0e3a2dc341e03e4be69330aae5c81920bd",
        label: "体积与音质的平衡",
    },
    Package {
        id: "breeze_tts_2_q8_0",
        precision: "q8_0",
        file: "breeze-tts-2-q8_0.gguf",
        size: 5_079_670_336,
        sha256: "b17b89b1c21107c44e8d556ab0a856d7acd06bdd0c914e68e0e57f6e33f555a3",
        label: "推荐：接近原始音质",
    },
    Package {
        id: "breeze_tts_2_bf16",
        precision: "bf16",
        file: "breeze-tts-2-bf16.gguf",
        size: 7_342_918_784,
        sha256: "5620623371e2011e9bb22389f12252d3969061adad139b3cdda6b1473a82a0d5",
        label: "原始精度，速度最慢",
    },
];

pub fn find(id: &str) -> Option<&'static Package> {
    PACKAGES.iter().find(|p| p.id == id)
}

#[derive(Serialize, Clone, Default)]
pub struct DownloadProgress {
    pub bytes: u64,
    pub total: u64,
    pub progress: f64,
    pub job_id: String,
}

impl Package {
    pub fn path(&self, models_dir: &Path) -> PathBuf {
        models_dir.join(self.file)
    }
    pub fn url(&self) -> String {
        format!("https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/Breeze-TTS-2-GGUF/{}", self.file)
    }
}

/// Resumable download with SHA-256 verification. `on_progress(bytes, total)` is called periodically.
pub async fn download(
    pkg: &Package,
    models_dir: &Path,
    cancel: tokio_util_cancel::Flag,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<PathBuf> {
    tokio::fs::create_dir_all(models_dir).await?;
    let final_path = pkg.path(models_dir);
    let part = models_dir.join(format!("{}.part", pkg.file));
    let mut hasher = Sha256::new();
    let mut have: u64 = 0;
    if let Ok(mut f) = tokio::fs::File::open(&part).await {
        use tokio::io::AsyncReadExt;
        let mut buf = vec![0u8; 8 << 20];
        loop {
            let n = f.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            have += n as u64;
        }
    }
    let client = reqwest::Client::builder().build()?;
    let mut req = client.get(pkg.url());
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await.context("connect to Hugging Face")?;
    if !(resp.status().is_success()) {
        bail!("download failed: HTTP {}", resp.status());
    }
    if have > 0 && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        have = 0;
        hasher = Sha256::new();
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(&part)
        .await?;
    let mut stream = resp.bytes_stream();
    let mut last_report = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        if cancel.is_set() {
            bail!("cancelled");
        }
        let chunk = chunk.context("network error")?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        have += chunk.len() as u64;
        if last_report.elapsed().as_millis() > 400 {
            on_progress(have, pkg.size);
            last_report = std::time::Instant::now();
        }
    }
    file.flush().await?;
    drop(file);
    on_progress(have, pkg.size);
    let digest = hex::encode(hasher.finalize());
    if digest != pkg.sha256 {
        let _ = tokio::fs::remove_file(&part).await;
        bail!("checksum mismatch; the partial download was removed, please retry");
    }
    tokio::fs::rename(&part, &final_path).await?;
    Ok(final_path)
}

pub mod tokio_util_cancel {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Clone, Default)]
    pub struct Flag(Arc<AtomicBool>);
    impl Flag {
        pub fn set(&self) {
            self.0.store(true, Ordering::SeqCst)
        }
        pub fn is_set(&self) -> bool {
            self.0.load(Ordering::SeqCst)
        }
    }
}
