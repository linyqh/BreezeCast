#!/usr/bin/env python3
"""BreezeCast CLI: thin 1:1 wrapper over the BreezeCast local REST API (stdlib only)."""
import argparse
import base64
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if sys.platform == "win32":
    DISCOVERY = os.path.join(os.environ.get("APPDATA", ""), "com.breezecast.studio", "api.json")
else:
    DISCOVERY = os.path.expanduser("~/Library/Application Support/com.breezecast.studio/api.json")
SHORT_TIMEOUT = 60
LONG_TIMEOUT = 1800
NOT_RUNNING = "BreezeCast is not running — open the app"


class ApiError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


def load_base():
    """BREEZECAST_URL (e.g. a LAN address of another machine) wins over the local discovery file."""
    base = os.environ.get("BREEZECAST_URL")
    if not base:
        try:
            with open(DISCOVERY, "r", encoding="utf-8") as f:
                base = json.load(f).get("base_url")
        except (OSError, ValueError):
            base = None
    if not base:
        raise ApiError(NOT_RUNNING + " (no discovery file at %s; set BREEZECAST_URL for a remote machine)" % DISCOVERY, "not_running")
    return base.rstrip("/")


def request(method, path, body=None, timeout=SHORT_TIMEOUT, query=None, raw=False):
    url = load_base() + "/api/v1" + path
    if query:
        q = {k: v for k, v in query.items() if v is not None}
        if q:
            url += "?" + urllib.parse.urlencode(q)
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read()
    except urllib.error.HTTPError as e:
        payload = e.read()
        code, msg = "http_%d" % e.code, e.reason
        try:
            err = json.loads(payload.decode("utf-8")).get("error", {})
            code = err.get("code", code)
            msg = err.get("message", msg)
        except (ValueError, AttributeError):
            if payload:
                msg = payload.decode("utf-8", "replace")[:500]
        raise ApiError(msg, code)
    except urllib.error.URLError as e:
        if isinstance(e.reason, socket.timeout):
            raise ApiError("request timed out after %ss" % timeout, "timeout")
        raise ApiError("%s (%s)" % (NOT_RUNNING, e.reason), "not_running")
    except socket.timeout:
        raise ApiError("request timed out after %ss" % timeout, "timeout")
    except OSError as e:
        raise ApiError("%s (%s)" % (NOT_RUNNING, e), "not_running")
    text = payload.decode("utf-8", "replace")
    if raw:
        return text
    if not text.strip():
        return {"ok": True}
    try:
        return json.loads(text)
    except ValueError:
        return text


def emit(obj):
    if isinstance(obj, str):
        sys.stdout.write(obj if obj.endswith("\n") else obj + "\n")
    else:
        print(json.dumps(obj, ensure_ascii=False, indent=2))


def read_text(args):
    if getattr(args, "text_file", None):
        with open(args.text_file, "r", encoding="utf-8") as f:
            return f.read()
    return args.text


def params_from(args):
    p = {}
    for key in ("guidance", "temperature", "seed"):
        v = getattr(args, key, None)
        if v is not None:
            p["guidance_scale" if key == "guidance" else key] = v
    return p


def resolve_voice(ref, by_name=False):
    voices = request("GET", "/voices")
    if not by_name:
        for v in voices:
            if v["id"] == ref:
                return v["id"]
    for v in voices:
        if v["name"] == ref:
            return v["id"]
    low = ref.lower()
    for v in voices:
        if v["name"].lower() == low:
            return v["id"]
    raise ApiError("voice not found: %r (known: %s)" % (ref, ", ".join(v["name"] for v in voices) or "none"), "voice_not_found")


def poll_job(job, label="job"):
    jid = job["id"]
    last = None
    while job.get("status") in ("queued", "running"):
        line = "%s %s %3.0f%% %s" % (label, job["status"], float(job.get("progress") or 0) * 100, job.get("message") or "")
        if line != last:
            sys.stderr.write(line + "\n")
            last = line
        time.sleep(2)
        job = request("GET", "/jobs/" + urllib.parse.quote(jid))
    if job.get("status") != "succeeded":
        raise ApiError("%s %s: %s" % (label, job.get("status"), job.get("error") or job.get("message") or ""), "job_" + str(job.get("status")))
    return job


# ---- commands -------------------------------------------------------------

def cmd_status(a):
    emit(request("GET", "/status"))


def cmd_capabilities(a):
    emit(request("GET", "/capabilities"))


def cmd_models(a):
    emit(request("GET", "/models"))


def cmd_model_download(a):
    job = request("POST", "/models/%s/download" % urllib.parse.quote(a.id))
    if a.wait:
        job = poll_job(job, "download")
    emit(job)


def cmd_voices(a):
    emit(request("GET", "/voices"))


def cmd_voice_show(a):
    emit(request("GET", "/voices/" + urllib.parse.quote(a.id)))


def cmd_audition(a):
    body = {"instruct": a.instruct, "text": a.text, "count": a.count,
            "params": {"guidance_scale": a.guidance}}
    if a.language:
        body["language"] = a.language
    if a.seed is not None:
        body["params"]["seed"] = a.seed
    emit(request("POST", "/voices/audition", body, LONG_TIMEOUT))


def cmd_voice_save_take(a):
    body = {"name": a.name, "instruct": a.instruct, "from_clip_id": a.clip}
    if a.description:
        body["description"] = a.description
    emit(request("POST", "/voices", body))


def cmd_voice_design(a):
    emit(request("POST", "/voices", {"name": a.name, "instruct": a.instruct, "source": "design"}))


def cmd_voice_clone(a):
    with open(os.path.expanduser(a.audio), "rb") as f:
        audio = base64.b64encode(f.read()).decode("ascii")
    body = {"name": a.name, "ref_audio_base64": audio, "ref_text": a.ref_text, "source": "clone"}
    if a.instruct:
        body["instruct"] = a.instruct
    emit(request("POST", "/voices", body))


def cmd_voice_delete(a):
    emit(request("DELETE", "/voices/" + urllib.parse.quote(a.id)))


def cmd_speak(a):
    body = {"text": read_text(a)}
    if a.voice and a.voice_name:
        raise ApiError("use only one of --voice / --voice-name", "bad_args")
    if a.voice:
        body["voice_id"] = a.voice
    elif a.voice_name:
        body["voice_id"] = resolve_voice(a.voice_name, by_name=True)
    if a.instruct:
        body["instruct"] = a.instruct
    if a.language:
        body["language"] = a.language
    p = params_from(a)
    if p:
        body["params"] = p
    clip = request("POST", "/speech", body, LONG_TIMEOUT)
    if a.out:
        out = os.path.abspath(os.path.expanduser(a.out))
        with urllib.request.urlopen(clip["url"], timeout=SHORT_TIMEOUT) as resp, open(out, "wb") as f:
            f.write(resp.read())
        clip["copied_to"] = out
    emit(clip)


def cmd_shows(a):
    emit(request("GET", "/shows"))


def cmd_show_create(a):
    body = {"title": a.title}
    for k in ("description", "author", "language"):
        if getattr(a, k):
            body[k] = getattr(a, k)
    emit(request("POST", "/shows", body))


def cmd_episodes(a):
    emit(request("GET", "/episodes", query={"show_id": a.show}))


def cmd_episode_create(a):
    with open(a.script_file, "r", encoding="utf-8") as f:
        script = f.read()
    cast = []
    for item in a.cast or []:
        if "=" not in item:
            raise ApiError("--cast expects 'Speaker=voice name or id', got %r" % item, "bad_args")
        speaker, ref = item.split("=", 1)
        cast.append({"speaker": speaker.strip(), "voice_id": resolve_voice(ref.strip())})
    body = {"title": a.title, "script": script, "cast": cast}
    if a.show:
        body["show_id"] = a.show
    if a.language:
        body["language"] = a.language
    if a.description:
        body["description"] = a.description
    emit(request("POST", "/episodes", body, LONG_TIMEOUT))


def cmd_episode_show(a):
    emit(request("GET", "/episodes/" + urllib.parse.quote(a.id)))


def cmd_render(a):
    body = {"force": bool(a.force), "wait": bool(a.wait)}
    job = request("POST", "/episodes/%s/render" % urllib.parse.quote(a.id), body, LONG_TIMEOUT)
    if a.wait:
        job = poll_job(job, "render")
    emit(job)


def cmd_line_set(a):
    body = {}
    if a.text is not None:
        body["text"] = a.text
    if a.direction is not None:
        body["direction"] = a.direction
    if a.pause_ms is not None:
        body["pause_ms"] = a.pause_ms
    if a.seed is not None:
        body["params"] = {"seed": a.seed}
    if not body:
        raise ApiError("nothing to change; pass --text/--direction/--pause-ms/--seed", "bad_args")
    emit(request("PATCH", "/episodes/%s/lines/%s" % (urllib.parse.quote(a.episode), urllib.parse.quote(a.line)), body))


def cmd_line_render(a):
    body = {"params": {"seed": a.seed}} if a.seed is not None else {}
    emit(request("POST", "/episodes/%s/lines/%s/render" % (urllib.parse.quote(a.episode), urllib.parse.quote(a.line)), body, LONG_TIMEOUT))


def cmd_export(a):
    body = {"format": a.format}
    if a.dir:
        body["dir"] = os.path.abspath(os.path.expanduser(a.dir))
    emit(request("POST", "/episodes/%s/export" % urllib.parse.quote(a.id), body, LONG_TIMEOUT))


def cmd_transcript(a):
    out = request("GET", "/episodes/%s/transcript" % urllib.parse.quote(a.id), query={"format": a.format}, timeout=LONG_TIMEOUT, raw=a.format != "json")
    emit(out)


def cmd_parse(a):
    with open(a.script_file, "r", encoding="utf-8") as f:
        emit(request("POST", "/scripts/parse", {"script": f.read()}))


def cmd_jobs(a):
    emit(request("GET", "/jobs", query={"limit": a.limit}))


def build_parser():
    p = argparse.ArgumentParser(prog="breezecast", description="BreezeCast local API client (needs the BreezeCast app running).")
    sub = p.add_subparsers(dest="cmd", metavar="COMMAND")
    sub.required = True

    def add(name, fn, help_):
        s = sub.add_parser(name, help=help_, description=help_)
        s.set_defaults(fn=fn)
        return s

    add("status", cmd_status, "App/engine/model/queue status")
    add("capabilities", cmd_capabilities, "Machine-readable capability description")
    add("models", cmd_models, "List model packages")
    s = add("model-download", cmd_model_download, "Download a model package")
    s.add_argument("id")
    s.add_argument("--wait", action="store_true", help="poll the job until finished")
    add("voices", cmd_voices, "List voices")
    s = add("voice-show", cmd_voice_show, "Show one voice")
    s.add_argument("id")
    s = add("audition", cmd_audition, "Voice Design takes without saving")
    s.add_argument("--instruct", required=True)
    s.add_argument("--text", required=True)
    s.add_argument("--count", type=int, default=3)
    s.add_argument("--language", choices=["zh", "en"])
    s.add_argument("--guidance", type=float, default=4.0)
    s.add_argument("--seed", type=int)
    s = add("voice-save-take", cmd_voice_save_take, "Save an audition take as a stable voice")
    s.add_argument("--clip", required=True)
    s.add_argument("--name", required=True)
    s.add_argument("--instruct", required=True)
    s.add_argument("--description")
    s = add("voice-design", cmd_voice_design, "Create a prompt-only design voice (identity varies per generation)")
    s.add_argument("--name", required=True)
    s.add_argument("--instruct", required=True)
    s = add("voice-clone", cmd_voice_clone, "Clone a voice from a WAV + exact transcript")
    s.add_argument("--name", required=True)
    s.add_argument("--audio", required=True, help="path to reference WAV")
    s.add_argument("--ref-text", required=True, help="exact transcript of the reference audio")
    s.add_argument("--instruct")
    s = add("voice-delete", cmd_voice_delete, "Delete a voice")
    s.add_argument("id")
    s = add("speak", cmd_speak, "Synthesize one utterance into a Clip")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--text")
    g.add_argument("--text-file")
    s.add_argument("--voice", help="voice id")
    s.add_argument("--voice-name", help="voice name (resolved via /voices)")
    s.add_argument("--instruct")
    s.add_argument("--language", choices=["zh", "en"])
    s.add_argument("--seed", type=int)
    s.add_argument("--guidance", type=float)
    s.add_argument("--temperature", type=float)
    s.add_argument("--out", help="copy the clip WAV to this path")
    add("shows", cmd_shows, "List shows")
    s = add("show-create", cmd_show_create, "Create a show")
    s.add_argument("--title", required=True)
    s.add_argument("--description")
    s.add_argument("--author")
    s.add_argument("--language", choices=["zh", "en"])
    s = add("episodes", cmd_episodes, "List episodes")
    s.add_argument("--show")
    s = add("episode-create", cmd_episode_create, "Create an episode from a script file and cast")
    s.add_argument("--title", required=True)
    s.add_argument("--show")
    s.add_argument("--script-file", required=True)
    s.add_argument("--cast", action="append", metavar="SPEAKER=VOICE", help="repeatable; voice name or id")
    s.add_argument("--language", choices=["zh", "en"])
    s.add_argument("--description")
    s = add("episode-show", cmd_episode_show, "Show an episode with lines")
    s.add_argument("id")
    s = add("render", cmd_render, "Render an episode (only stale/unrendered lines unless --force)")
    s.add_argument("id")
    s.add_argument("--force", action="store_true")
    s.add_argument("--wait", action="store_true")
    s = add("line-set", cmd_line_set, "Edit a line's text/direction/pause/seed (marks it stale)")
    s.add_argument("episode")
    s.add_argument("line")
    s.add_argument("--text")
    s.add_argument("--direction")
    s.add_argument("--pause-ms", type=int)
    s.add_argument("--seed", type=int)
    s = add("line-render", cmd_line_render, "Synchronously re-render one line")
    s.add_argument("episode")
    s.add_argument("line")
    s.add_argument("--seed", type=int)
    s = add("export", cmd_export, "Export episode audio + srt/chapters/transcript")
    s.add_argument("id")
    s.add_argument("--format", choices=["m4a", "wav"], default="m4a")
    s.add_argument("--dir")
    s = add("transcript", cmd_transcript, "Print episode transcript")
    s.add_argument("id")
    s.add_argument("--format", choices=["srt", "json", "txt"], default="srt")
    s = add("parse", cmd_parse, "Parse a script file without creating anything")
    s.add_argument("--script-file", required=True)
    s = add("jobs", cmd_jobs, "List recent jobs")
    s.add_argument("--limit", type=int, default=50)
    return p


def main():
    args = build_parser().parse_args()
    try:
        args.fn(args)
    except ApiError as e:
        sys.stderr.write("error [%s]: %s\n" % (e.code or "error", e))
        return 1
    except OSError as e:
        sys.stderr.write("error [io]: %s\n" % e)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
