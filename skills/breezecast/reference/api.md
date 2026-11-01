# BreezeCast Local API

BreezeCast exposes every capability of the desktop app through a local HTTP API.
The app UI itself uses this API, so anything you can do in the UI an agent can do too.

- Base URL: `http://127.0.0.1:17860` on this machine, or `http://<LAN IP>:17860` from other devices on the
  same network (port configurable in Settings). The server listens on all interfaces as soon as the app starts.
- Auth: none. Every endpoint is open to anyone who can reach the port — use only on trusted networks.
- Discovery: the running app writes `api.json` to its data directory —
  `~/Library/Application Support/com.breezecast.studio/api.json` on macOS,
  `%APPDATA%\com.breezecast.studio\api.json` on Windows:
  ```json
  {"base_url":"http://127.0.0.1:17860","lan_url":"http://192.168.1.20:17860","pid":12345,"version":"0.1.0"}
  ```
- Returned `url` fields use the host the client connected through, so they work from LAN devices too.
  `path` fields are absolute paths on the BreezeCast machine; remote clients should use `url` and upload
  reference audio with `ref_audio_base64` instead of `ref_audio_path`.
- All bodies are JSON (`Content-Type: application/json`). Errors: HTTP 4xx/5xx with
  `{"error":{"code":"…","message":"…"}}`.
- IDs are opaque strings. Times are RFC 3339. Durations are milliseconds.
- Files (`path` fields) are absolute paths on this machine; agents running locally can read them directly.

## Model facts (BreezeTTS 2)

| Capability | How to use it |
|---|---|
| Voice Design | No reference audio; `instruct` describes the voice ("A warm, thoughtful young woman…"). Use `guidance_scale: 4` for strong instruction following. Write the instruction in the same language as the text. |
| Voice Clone | Reference audio (clean speech, 3–20 s; WAV/MP3/M4A/AIFF/FLAC, converted to 24 kHz mono) **plus its exact transcript**. |
| Voice Direction | Clone + `instruct` steering tone/emotion/pace ("Speak slowly with a restrained, serious tone."), `guidance_scale: 4`. |
| Vocal events | Inline in text. English uses parentheses: `(laugh)` `(cough)` `(clears throat)` `(sigh)`. Chinese uses square brackets: `[笑]` `[咳嗽]` `[清嗓子]` `[叹气]`. |
| Languages | `zh`, `en` (mixed text works). |
| Streaming | 24 kHz mono PCM16, incremental. |
| Long text | Auto-chunked (`text_chunk_size`, default 600 chars); a voice without reference stays consistent across chunks. |

Sampling params (all optional, in `params`):

| Name | Type | Default | Notes |
|---|---|---|---|
| `guidance_scale` | float ≥ 0 | auto: 4 when an instruction/direction is present, else 1 | Classifier-free guidance; higher follows the instruction more closely, ~2× slower |
| `temperature` | float > 0 | 0.9 | Backbone sampling temperature |
| `depth_temperature` | float > 0 | 0.9 | Depth decoder temperature |
| `top_k` | int | 50 | ≤0 disables |
| `top_p` | float (0,1] | 1.0 | 1 disables |
| `seed` | int ≥ 0 | random per request unless given | Same seed + same inputs → same take |
| `max_tokens` | int > 0 | 1500 | Max acoustic frames per chunk (12.5 frames ≈ 1 s) |
| `text_chunk_size` | int > 0 | 600 | Long-form chunk size in characters |
| `text_chunk_mode` | `default`\|`tag_aware`\|`endline` | `default` | |

## Objects

```ts
Voice = {
  id: string, name: string, description: string,
  language: "zh" | "en" | "auto",
  source: "design" | "clone" | "record",
  instruct: string,            // base style / design prompt; may be ""
  ref_text: string | null,     // transcript of reference audio
  has_reference: boolean,      // true → generation clones ref audio (stable identity)
  ref_path: string | null,     // absolute WAV path
  ref_url: string | null,      // GET-able URL of the reference WAV
  params: Params,              // voice-level default params (e.g. seed, guidance_scale)
  color: string,               // UI accent, e.g. "#5E5CE6"
  created_at: string, updated_at: string
}

Clip = {                       // any single generated utterance
  id: string, text: string, instruct: string, voice_id: string | null,
  params: Params, seed: number, duration_ms: number, path: string, url: string,
  kind: "speech" | "audition", created_at: string
}

Show = { id, title, description, author, language, color, created_at, updated_at,
         episode_count: number }

Episode = {
  id, show_id: string | null, title, description, language,
  cast: CastMember[],          // speaker name → voice
  lines: Line[],
  params: Params,              // episode-level default params
  status: "draft" | "rendering" | "rendered" | "stale" | "failed",
  audio: { path, url, duration_ms, rendered_at } | null,
  created_at, updated_at
}
CastMember = { speaker: string, voice_id: string }
Line = {
  id: string, speaker: string, text: string,
  direction: string,           // per-line voice direction (instruct); "" = voice default
  pause_ms: number,            // silence AFTER this line, default 400
  params: Params | null,       // per-line overrides (e.g. a locked seed)
  audio: { path, url, duration_ms, hash, seed } | null,  // null = needs render
  stale: boolean
}

Job = {
  id, kind: "render_episode" | "model_download" | "audition",
  target_id: string, status: "queued" | "running" | "succeeded" | "failed" | "cancelled",
  progress: number /*0..1*/, message: string, error: string | null,
  result: any | null, created_at, updated_at
}
```

How a line's request is built: the line speaker → `cast` → voice.
If the voice has reference audio it is cloned; `direction` (or else the voice's `instruct`)
becomes the instruction (Voice Direction). Without reference audio the instruction is
`voice.instruct` followed by `direction` (Voice Design). Params merge
`defaults < episode.params < voice.params < line.params`.

## Endpoints

### System
- `GET /api/v1/status` → `{app_version, api:{base_url}, engine:{state:"stopped"|"starting"|"ready"|"error", message, backend, port}, model:{active_package, installed:[id]}, queue:{running, queued}}`
- `GET /api/v1/capabilities` → static machine-readable capability description (vocal events, params, limits, script syntax).
- `GET /api/v1/settings` / `PATCH /api/v1/settings` → `{active_package, bf16_activations:"auto"|"on"|"off", default_params:Params, api_port, keep_model_loaded:boolean}`. Changing engine fields restarts the engine.
- `POST /api/v1/engine/restart` → `{ok:true}`
- `GET /api/v1/engine/logs?lines=200` → `{lines:[string]}`
- `GET /api/v1/events` → Server-Sent Events: `{"type":"job","job":Job}`, `{"type":"engine","engine":{…}}`, `{"type":"episode","episode_id":…}`, `{"type":"voices"}`.

### Models (GGUF packages of BreezeTTS 2)
- `GET /api/v1/models` → `[{id:"breeze_tts_2_q8_0", precision:"q8_0", file, size_bytes, installed, active, recommended, download:{progress,bytes,total}|null}]`
  Packages: `breeze_tts_2_q4_0` (3.8 GB), `breeze_tts_2_q4_k` (4.5 GB), `breeze_tts_2_q8_0` (5.1 GB, default), `breeze_tts_2_bf16` (7.3 GB, reference quality).
- `POST /api/v1/models/{id}/download` → `Job` (progress via events / jobs)
- `POST /api/v1/models/{id}/activate` → settings
- `DELETE /api/v1/models/{id}`

### Speech (single utterances)
- `POST /api/v1/speech` — synthesize and store a Clip.
  ```json
  {
    "text": "[笑] 欢迎收听本期节目。",
    "voice_id": "v_…",                 // optional
    "instruct": "语气轻快，语速稍快。",   // optional (design prompt or direction)
    "ref_audio_base64": "…", "ref_text": "…",  // optional inline clone (WAV/MP3/M4A/AIFF/FLAC)
    "ref_audio_path": "/abs/file.wav",          // optional alternative
    "language": "zh",
    "params": {"guidance_scale": 4, "seed": 42}
  }
  ```
  → `Clip` (audio at `clip.path` / `clip.url`).
- `POST /api/v1/speech/stream` — same body; responds `text/event-stream`:
  `{"type":"audio","sample_rate":24000,"pcm16_base64":"…"}` … then `{"type":"done","clip":Clip}` or `{"type":"error","message":…}`.
- `GET /api/v1/clips?limit=50` → `[Clip]`; `GET /api/v1/clips/{id}`; `DELETE /api/v1/clips/{id}`
- `GET /api/v1/clips/{id}/audio` → `audio/wav`

### Voices
- `GET /api/v1/voices` → `[Voice]`; `GET /api/v1/voices/{id}`
- `POST /api/v1/voices/audition` — Voice Design takes without saving.
  `{"instruct":"…","text":"…","language":"zh","count":3,"params":{"guidance_scale":4}}` → `{"takes":[Clip]}` (each take has its own seed).
- `POST /api/v1/voices` — create:
  - design from a take (recommended, gives a stable voice): `{"name","description","instruct","from_clip_id":"c_…"}`
    (the take audio + text become the voice's reference so the identity is fixed)
  - design prompt only (identity varies per generation): `{"name","instruct","source":"design"}`
  - clone: `{"name","ref_audio_base64"|"ref_audio_path","ref_text","instruct"?, "source":"clone"}`
- `PATCH /api/v1/voices/{id}` (name, description, instruct, ref_text, params, color, language)
- `DELETE /api/v1/voices/{id}`
- `GET /api/v1/voices/{id}/audio` → reference WAV
- `POST /api/v1/voices/{id}/preview` `{"text"?,"direction"?}` → `Clip`

### Shows & Episodes
- `GET /api/v1/shows`, `POST /api/v1/shows` `{title, description?, author?, language?, color?}`,
  `GET|PATCH|DELETE /api/v1/shows/{id}`
- `GET /api/v1/episodes?show_id=…` → `[Episode]` (lines omitted, `line_count` added)
- `POST /api/v1/episodes` → `Episode`. Body:
  ```json
  {
    "show_id": "s_…", "title": "第 1 期：AI 与声音", "language": "zh",
    "cast": [{"speaker":"主持人","voice_id":"v_…"}, {"speaker":"嘉宾","voice_id":"v_…"}],
    "lines": [{"speaker":"主持人","text":"[笑] 大家好！","direction":"热情开场","pause_ms":400}],
    "script": "主持人: …\n嘉宾 {轻声}: …"     // alternative to lines (see Script format)
  }
  ```
  Speakers without a cast entry are auto-assigned the first matching voice by name, else left unassigned (render fails with `cast_missing`).
- `GET /api/v1/episodes/{id}`, `PATCH /api/v1/episodes/{id}` (title, description, show_id, cast, params, lines, script), `DELETE /api/v1/episodes/{id}`
- `POST /api/v1/episodes/{id}/lines` `{after_line_id?, speaker, text, direction?, pause_ms?}` → Episode
- `PATCH /api/v1/episodes/{id}/lines/{line_id}` → Episode; `DELETE …/lines/{line_id}` → Episode
- `POST /api/v1/episodes/{id}/render` `{"line_ids"?: [..], "force"?: false, "wait"?: false}` → `Job`
  (with `wait:true` the response is sent when the job finishes). Only stale/unrendered lines are synthesized unless `force`. Then all lines are stitched with pauses and loudness-normalized.
- `POST /api/v1/episodes/{id}/lines/{line_id}/render` `{"params"?:{seed}}` → Episode (synchronous single-line take)
- `GET /api/v1/episodes/{id}/audio` → `audio/wav` of the stitched episode
- `GET /api/v1/episodes/{id}/lines/{line_id}/audio` → `audio/wav`
- `POST /api/v1/episodes/{id}/export` `{"format":"m4a"|"wav","dir"?: "/abs/dir"}` → `{audio_path, srt_path, chapters_path, transcript_path}`
- `GET /api/v1/episodes/{id}/transcript?format=srt|json|txt`

### Jobs
- `GET /api/v1/jobs?limit=50`, `GET /api/v1/jobs/{id}`, `POST /api/v1/jobs/{id}/cancel`

### Script parsing
- `POST /api/v1/scripts/parse` `{"script":"…"}` → `{speakers:[string], lines:[Line-like]}`

## Script format

```
# Optional title line (ignored)
主持人: [笑] 欢迎收听《声波漫谈》。
嘉宾 {轻声，带点犹豫}: 嗯……其实我一开始也不太确定。
<pause 1.5s>
Host {excited, fast}: (laugh) That's amazing!
```
- `Speaker: text` (ASCII `:` or full-width `：`).
- `{…}` after the speaker name = per-line direction.
- `<pause N s>` / `<pause N ms>` on its own line adds silence after the previous line.
- Lines without a speaker prefix continue the previous speaker's line.
