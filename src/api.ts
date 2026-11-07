import { invoke } from "@tauri-apps/api/core";
import i18n from "./i18n";

export type Params = {
  guidance_scale?: number;
  temperature?: number;
  depth_temperature?: number;
  top_k?: number;
  top_p?: number;
  seed?: number;
  max_tokens?: number;
  text_chunk_size?: number;
  text_chunk_mode?: string;
};

export type Voice = {
  id: string;
  name: string;
  description: string;
  language: string;
  source: "design" | "clone" | "record";
  instruct: string;
  ref_text: string | null;
  ref_path: string | null;
  ref_url: string | null;
  has_reference: boolean;
  params: Params;
  color: string;
  created_at: string;
  updated_at: string;
};

export type Clip = {
  id: string;
  text: string;
  instruct: string;
  voice_id: string | null;
  params: Params;
  seed: number;
  duration_ms: number;
  path: string;
  url: string;
  kind: string;
  created_at: string;
};

export type Show = {
  id: string;
  title: string;
  description: string;
  author: string;
  language: string;
  color: string;
  episode_count: number;
  created_at: string;
};

export type LineAudio = { path: string; url: string; duration_ms: number; hash: string; seed: number };
export type Line = {
  id: string;
  speaker: string;
  text: string;
  direction: string;
  pause_ms: number;
  params: Params | null;
  audio: LineAudio | null;
  stale: boolean;
};
export type Chapter = { line_id: string; speaker: string; text: string; start_ms: number; end_ms: number };
export type Job = {
  id: string;
  kind: string;
  target_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  message: string;
  /** i18n key under `job.*` (+ interpolation args) for localising `message`. */
  message_key?: string | null;
  message_args?: Record<string, unknown> | null;
  error: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
};
export type Episode = {
  id: string;
  show_id: string | null;
  title: string;
  description: string;
  language: string;
  cast: { speaker: string; voice_id: string }[];
  lines: Line[];
  line_count?: number;
  params: Params;
  status: "draft" | "rendering" | "rendered" | "stale" | "failed";
  failed: string | null;
  audio: { path: string; url: string; duration_ms: number; rendered_at: string; chapters?: Chapter[] } | null;
  job: Job | null;
  created_at: string;
  updated_at: string;
};
export type EngineStatus = { state: "stopped" | "starting" | "ready" | "error" | "no_model"; message: string; backend: string; port: number };
const BACKEND_LABELS: Record<string, string> = { metal: "Metal", vulkan: "Vulkan", cuda: "CUDA", cpu: "CPU" };
export const backendLabel = (b?: string) => (b ? BACKEND_LABELS[b] ?? b.toUpperCase() : "—");
export type Status = {
  app_version: string;
  api: { base_url: string; lan_url: string | null; port: number };
  engine: EngineStatus;
  model: { active_package: string; installed: string[] };
  queue: { running: number; queued: number };
  data_dir: string;
};
export type Settings = {
  active_package: string;
  bf16_activations: "auto" | "on" | "off";
  default_params: Params;
  api_port: number;
  keep_model_loaded: boolean;
  export_dir: string | null;
};
export type ModelPackage = {
  id: string;
  precision: string;
  file: string;
  size_bytes: number;
  label: string;
  installed: boolean;
  active: boolean;
  recommended: boolean;
  download: { bytes: number; total: number; progress: number; job_id: string } | null;
};

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

let base = "";

export async function initApi(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const info = await invoke<{ base_url: string } | null>("api_info");
    if (info) {
      base = info.base_url;
      try {
        await fetch(`${base}/api/v1/status`);
        return;
      } catch {
        /* server still binding */
      }
    }
    await sleep(150);
  }
  throw new Error(i18n.t("app.apiUnavailable"));
}

/** Localised job status line; falls back to the backend's own text for unknown/neutral messages. */
export function jobMessage(job: Job): string {
  if (!job.message_key) return job.message;
  // Keys come from the backend at runtime, so they cannot be statically checked.
  return i18n.t(job.message_key as "job.done", { ...job.message_args, defaultValue: job.message });
}

export const apiBase = () => base;

type ErrorBody = { error?: { code?: string; message?: string } };

function errorOf(data: unknown): { code?: string; message?: string } {
  if (data && typeof data === "object" && "error" in data) return (data as ErrorBody).error ?? {};
  return {};
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = errorOf(data);
    throw new ApiError(e.code ?? "error", e.message ?? `HTTP ${res.status}`, res.status);
  }
  // Response shapes are defined by docs/API.md; callers name the type.
  return data as T;
}

export const get = <T = unknown>(p: string) => api<T>("GET", p);
export const post = <T = unknown>(p: string, b: unknown = {}) => api<T>("POST", p, b);
export const patch = <T = unknown>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const del = <T = unknown>(p: string) => api<T>("DELETE", p);

/** Cache-busts an API media URL on `version` so a re-rendered take reloads. */
export function mediaUrl(url: string, version?: string | number): string {
  if (version === undefined) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(version))}`;
}

export type AppEvent =
  | { type: "job"; job: Job }
  | { type: "engine"; engine: EngineStatus }
  | { type: "episode"; episode_id: string }
  | { type: "voices" }
  | { type: "shows" };

export function subscribe(onEvent: (e: AppEvent) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  const connect = () => {
    es = new EventSource(`${base}/api/v1/events`);
    es.onmessage = (m) => onEvent(JSON.parse(m.data));
    es.onerror = () => {
      es?.close();
      if (!closed) setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    closed = true;
    es?.close();
  };
}

export type StreamHandlers = {
  onAudio: (pcm: Int16Array) => void;
  onDone: (clip: Clip) => void;
  onError: (message: string) => void;
};

/** POST /speech/stream and decode SSE frames. Returns an abort function. */
export function streamSpeech(body: unknown, h: StreamHandlers): () => void {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${base}/api/v1/speech/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const e = errorOf(await res.json().catch(() => null));
        h.onError(e.message ?? `HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5)) as StreamEvent;
            if (ev.type === "audio") {
              const bin = atob(ev.pcm16_base64);
              const bytes = new Uint8Array(bin.length);
              for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
              h.onAudio(new Int16Array(bytes.buffer, 0, bytes.length >> 1));
            } else if (ev.type === "done") h.onDone(ev.clip);
            else h.onError(ev.message);
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) h.onError(e instanceof Error ? e.message : String(e));
    }
  })();
  return () => ctrl.abort();
}

type StreamEvent =
  | { type: "audio"; pcm16_base64: string }
  | { type: "done"; clip: Clip }
  | { type: "error"; message: string };

export function fileToBase64(file: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split("base64,")[1] ?? "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
  return promise;
}

export const VOCAL_EVENTS = {
  zh: [
    { tag: "[笑]", label: "笑" },
    { tag: "[叹气]", label: "叹气" },
    { tag: "[咳嗽]", label: "咳嗽" },
    { tag: "[清嗓子]", label: "清嗓子" },
  ],
  en: [
    { tag: "(laugh)", label: "laugh" },
    { tag: "(sigh)", label: "sigh" },
    { tag: "(cough)", label: "cough" },
    { tag: "(clears throat)", label: "clears throat" },
  ],
};

export function fmtMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function isZh(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}
