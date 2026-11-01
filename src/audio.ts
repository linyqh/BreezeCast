/** Plays incrementally arriving 24 kHz PCM16 chunks gaplessly. */
export class PcmStreamPlayer {
  private ctx: AudioContext;
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];
  readonly analyser: AnalyserNode;

  constructor(private sampleRate = 24000) {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
  }

  push(pcm: Int16Array) {
    if (pcm.length === 0) return;
    const buf = this.ctx.createBuffer(1, pcm.length, this.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    // A small lead absorbs network jitter on the first chunk.
    const start = Math.max(this.next, this.ctx.currentTime + 0.06);
    src.start(start);
    this.next = start + buf.duration;
    this.sources.push(src);
  }

  /** Seconds of audio still scheduled. */
  remaining(): number {
    return Math.max(0, this.next - this.ctx.currentTime);
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
    }
    this.sources = [];
    void this.ctx.close();
  }
}

/** Records the microphone as mono 16-bit WAV. */
export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  analyser: AnalyserNode | null = null;
  sampleRate = 48000;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    this.sampleRate = this.ctx.sampleRate;
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.analyser);
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  elapsed(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0) / this.sampleRate;
  }

  async stop(): Promise<Blob> {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      pcm.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return encodeWav(pcm, this.sampleRate);
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Downsampled absolute peaks for drawing a waveform. */
export async function peaksOf(url: string, bins = 160): Promise<number[]> {
  const data = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 24000);
  const audio = await ctx.decodeAudioData(data);
  const ch = audio.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / bins));
  const out: number[] = [];
  for (let i = 0; i < bins; i++) {
    let m = 0;
    for (let k = i * step; k < Math.min(ch.length, (i + 1) * step); k++) m = Math.max(m, Math.abs(ch[k]));
    out.push(m);
  }
  const max = Math.max(...out, 1e-4);
  return out.map((p) => p / max);
}
