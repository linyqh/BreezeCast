---
name: breezecast
description: Use when the user wants to generate speech, make a podcast, design a new voice, or clone a voice locally on their Mac or Windows PC with BreezeCast + BreezeTTS 2 (Chinese/English text-to-speech, voice direction, episode rendering, m4a/srt export).
---

# BreezeCast

BreezeCast is a macOS / Windows podcast studio. It exposes a REST API (no auth, reachable on the LAN); this skill drives it through `scripts/breezecast.py` (Python 3, stdlib only). All commands print JSON to stdout; errors go to stderr with a non-zero exit and the API error code. When BreezeCast runs on this machine, `path` fields are local files you can read directly; on a remote machine use the `url` fields.

Below, `BC` means `python3 <skill-dir>/scripts/breezecast.py` (on Windows usually `py` or `python` instead of `python3`). Raw HTTP details: `reference/api.md`.

## Preconditions (always check first)

1. `BC status` — if it errors with "BreezeCast is not running — open the app", ask the user to open BreezeCast. Do not try to launch the backend yourself.
2. In the status JSON: `engine.state` must be `ready` (`starting` → wait and re-check; `error` → show `engine.message`, try `POST /engine/restart` or tell the user). `model.installed` must be non-empty.
3. No model installed: tell the user (packages are 3.8–7.3 GB) and, with their consent, `BC models` then `BC model-download breeze_tts_2_q8_0 --wait` (default, 5.1 GB).

Discovery is automatic on the same machine (`~/Library/Application Support/com.breezecast.studio/api.json` on macOS, `%APPDATA%\com.breezecast.studio\api.json` on Windows). To drive BreezeCast on another machine in the LAN, set `BREEZECAST_URL=http://<its LAN IP>:17860` (shown in the app under "API 与 Agent"). `BC capabilities` returns the machine-readable list of events, params, limits and script syntax.

## Workflows

### (a) Quick speech
```
BC voices
BC speak --text "大家好，欢迎收听本期节目。" --voice-name "Mia" --out /tmp/hello.wav
BC speak --text-file note.txt --instruct "Speak slowly, calm tone." --guidance 4 --out /tmp/note.wav
```
Omit `--voice`/`--voice-name` only for plain design-prompt speech (`--instruct`). The result is a Clip; the WAV is at `clip.url` (and `clip.path` on the BreezeCast machine); `--out` downloads it.

### (b) Design a voice, audition takes, save the best
```
BC audition --instruct "A warm, thoughtful young woman with a calm pace." --text "Hello, and welcome to the show." --count 3
# listen/inspect takes[].path, choose a clip id
BC voice-save-take --clip c_123 --name "Mia" --instruct "A warm, thoughtful young woman with a calm pace." --description "Host voice"
```
Saving a take makes the take audio the voice's reference, so the identity is stable. `BC voice-design --name X --instruct "..."` (prompt-only) is NOT stable: identity varies per generation. Prefer audition + save-take for any voice reused across lines/episodes. Write `--instruct` in the same language as `--text` (e.g. `一位温和沉稳的中年男声，语速适中。` with Chinese text). Use `--seed` to reproduce a take.

### (c) Clone a voice from a recording
```
BC voice-clone --name "Alex" --audio /abs/path/ref.wav --ref-text "The exact words spoken in the recording." 
```
Reference: clean speech, 3–20 s, single speaker, no music (WAV/MP3/M4A/AIFF/FLAC are converted automatically), and `--ref-text` must match the audio word for word. Check with `BC speak --voice-name Alex --text "..."`. Delete a bad voice with `BC voice-delete ID`.

### (d) Voice direction (tone/emotion/pace per utterance)
A voice with reference audio (cloned or saved take) plus `--instruct` = Voice Direction:
```
BC speak --voice-name Alex --text "We have to talk about last quarter." --instruct "Speak slowly with a restrained, serious tone." --guidance 4
```
In episodes, direction is per line: `Speaker {direction}: text` (see (e)).

### (e) Two-person podcast, end to end
1. Make sure two voices exist (`BC voices`; create via (b)/(c)).
2. Write the script file in the documented format:
```
# 声波漫谈 第 1 期（title line ignored）
主持人 {热情开场}: [笑] 大家好，欢迎收听《声波漫谈》。今天我们聊聊本地语音合成。
嘉宾 {轻声，带点犹豫}: 嗯……其实我一开始也不太确定。
<pause 1.5s>
主持人: 没关系，我们慢慢聊。[叹气] 先从最简单的说起吧。
```
English: `Host {excited, fast}: (laugh) That's amazing!` Rules: `Speaker: text` (ASCII `:` or `：`); `{...}` after the name is a per-line direction; `<pause 1.5s>` / `<pause 800ms>` on its own line adds silence after the previous line; a line with no speaker prefix continues the previous speaker.
3. Validate (optional): `BC parse --script-file ep1.txt`.
4. Create, render, export:
```
BC show-create --title "声波漫谈" --language zh          # optional; note show id
BC episode-create --title "第 1 期" --show s_1 --script-file ep1.txt --cast '主持人=Mia' --cast '嘉宾=Alex'
BC render EP_ID --wait
BC export EP_ID --format m4a --dir ~/Desktop/podcast
BC transcript EP_ID --format srt
```
`--cast` accepts a voice name or id. Unmapped speakers fail rendering with `cast_missing`. `export` returns `audio_path`, `srt_path`, `chapters_path`, `transcript_path`. `render` only synthesizes stale/unrendered lines; `--force` redoes all.

### (f) Iterate on one line
```
BC episode-show EP_ID                                   # find line ids, check audio/stale
BC line-set EP_ID LINE_ID --direction "更轻松一点，语速稍快" # or --text / --pause-ms
BC line-render EP_ID LINE_ID                            # synchronous new take (fresh random seed)
BC line-render EP_ID LINE_ID --seed 8                   # or reproduce/try a specific seed
BC render EP_ID --wait                                  # re-stitch the full episode
BC export EP_ID --format m4a
```
Check `episode-show` afterwards: `lines[].audio.seed` records the seed used; `line-set --seed N` locks a seed on the line.

## Writing guidance for BreezeTTS 2

- Languages: `zh` and `en`; mixed text works.
- Vocal events go inline in the text. English: parentheses `(laugh)` `(cough)` `(clears throat)` `(sigh)`. Chinese: square brackets `[笑]` `[咳嗽]` `[清嗓子]` `[叹气]`. Use the form that matches the text language; use sparingly (≈1 per few lines).
- Instruct language must match text language. Be concrete: gender/age feel, pace, tone, emotion ("语气轻快，语速稍快。").
- `guidance_scale` defaults to auto: 4 when an instruction/direction is present, else 1. Pass `--guidance` only to override (higher = follows the instruction more, ~2x slower).
- Keep each line under ~300 characters (long text is auto-chunked at 600, but shorter lines sound better and re-render faster). One idea per line.
- Write numbers, dates, units and abbreviations as spoken: `2024年` → `二零二四年`, `3.5%` → `百分之三点五`, `GPU` → `G P U`, `$20` → `twenty dollars`.
- Pauses: tune `pause_ms` / `<pause Ns>` instead of padding with punctuation; ellipsis `……` gives hesitation.
- Reference audio: clean 3–20 s, one speaker, with the exact transcript. A wrong transcript degrades the clone.
- Same seed + same inputs reproduces the same take; change `--seed` to get a different take.

## Failure handling

- Non-zero exit: read stderr `error [code]: message`. `cast_missing` → add `--cast`; `engine_starting` → wait and retry; `engine_no_model` / `engine_unavailable` → `BC status`, then ask the user; `not_found` → re-list (`BC voices`, `BC episodes`).
- Long operations (`speak`, `render`, `audition`) have a 30-minute client timeout; `render --wait` prints progress to stderr.
- Do not delete user voices, shows, or episodes unless asked.
