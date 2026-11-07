import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Copy, Square, Trash2, UserPlus, Zap } from "lucide-react";
import { del, get, isZh, post, streamSpeech, type Clip, type Params } from "../api";
import { PcmStreamPlayer } from "../audio";
import { defaultContentLang, sampleText } from "../i18n";
import { usePlayer, useStore } from "../store";
import { Duration, EventChips, ParamsPanel, PlayButton, Segmented, Sheet, Spinner, VoiceSelect } from "../ui";

export function SaveClipAsVoice({ clip, onClose, defaultInstruct = "" }: { clip: Clip; onClose: () => void; defaultInstruct?: string }) {
  const { t } = useTranslation();
  const { fail, toast, go } = useStore();
  const [name, setName] = useState("");
  const [instruct, setInstruct] = useState(defaultInstruct || clip.instruct);
  const save = async () => {
    try {
      await post("/voices", { name, instruct, description: clip.instruct, from_clip_id: clip.id, language: isZh(clip.text) ? "zh" : "en" });
      toast(t("speak.save.saved", { name }));
      onClose();
      go({ name: "voices" });
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet
      title={t("speak.save.title")}
      subtitle={t("speak.save.subtitle")}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>{t("common.save")}</button>
        </>
      }
    >
      <div className="vstack">
        <div className="field">
          <label>{t("speak.save.name")}</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("speak.save.namePlaceholder")} />
        </div>
        <div className="field">
          <label>{t("speak.save.instruct")}</label>
          <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder={t("speak.save.instructPlaceholder")} />
        </div>
      </div>
    </Sheet>
  );
}

export function SpeakView() {
  const { t } = useTranslation();
  const { voices, fail, engine } = useStore();
  const player = usePlayer();
  const [text, setText] = useState(() => sampleText("speakText", defaultContentLang()));
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [instruct, setInstruct] = useState(() => t("speak.defaultInstruct", { lng: defaultContentLang() === "zh" ? "zh-CN" : "en" }));
  const [params, setParams] = useState<Params>({});
  const [mode, setMode] = useState<"stream" | "offline">("stream");
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<number[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [saveClip, setSaveClip] = useState<Clip | null>(null);
  const [ttfa, setTtfa] = useState<number | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const ta = useRef<HTMLTextAreaElement>(null);
  const voice = voices.find((v) => v.id === voiceId);
  const zh = isZh(text);

  const loadClips = () => get<Clip[]>("/clips?kind=speech&limit=30").then(setClips, fail);
  useEffect(() => {
    void loadClips();
    return () => stopRef.current();
  }, []);

  const run = async () => {
    const body = { text, voice_id: voiceId, instruct, params };
    setBusy(true);
    setTtfa(null);
    if (mode === "offline") {
      try {
        const clip = await post<Clip>("/speech", body);
        player.play({ key: `clip-${clip.id}`, url: clip.url, title: t("speak.clipTitle"), subtitle: clip.text, color: voice?.color });
        void loadClips();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    player.stop();
    const pcm = new PcmStreamPlayer();
    const t0 = performance.now();
    let raf = 0;
    const buf = new Uint8Array(pcm.analyser.frequencyBinCount);
    const tick = () => {
      pcm.analyser.getByteTimeDomainData(buf);
      const bars: number[] = [];
      for (let i = 0; i < 48; i++) bars.push(Math.abs(buf[Math.floor((i * buf.length) / 48)] - 128) / 128);
      setLevel(bars);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let first = true;
    const finish = () => {
      setBusy(false);
      window.setTimeout(() => {
        cancelAnimationFrame(raf);
        setLevel([]);
        pcm.stop();
      }, pcm.remaining() * 1000 + 300);
    };
    const abort = streamSpeech(body, {
      onAudio: (chunk) => {
        if (first) {
          setTtfa(performance.now() - t0);
          first = false;
        }
        pcm.push(chunk);
      },
      onDone: () => {
        finish();
        void loadClips();
      },
      onError: (m) => {
        finish();
        fail(m);
      },
    });
    stopRef.current = () => {
      abort();
      cancelAnimationFrame(raf);
      setLevel([]);
      pcm.stop();
      setBusy(false);
    };
  };

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("speak.title")}</h1>
        <span className="sub">{t("speak.subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={mode} onChange={setMode} options={[{ value: "stream", label: <><Zap size={12} /> {t("speak.modeStream")}</> }, { value: "offline", label: t("speak.modeOffline") }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            <div className="card pad">
              <textarea ref={ta} className="textarea" style={{ minHeight: 170, fontSize: 16, background: "none", boxShadow: "none", padding: 0 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("speak.placeholder")} />
              <div className="hstack" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <EventChips target={ta} value={text} onChange={setText} lang={zh ? "zh" : "en"} />
                <span style={{ flex: 1 }} />
                <span className="hint">{t("speak.charCount", { count: text.length })}</span>
              </div>
            </div>
            <div className="card pad vstack">
              <div className="grid cols-2">
                <div className="field">
                  <label>{t("speak.voice")}</label>
                  <VoiceSelect voices={voices} value={voiceId} onChange={setVoiceId} allowNone noneLabel={t("speak.noReference")} />
                </div>
                <div className="field">
                  <label>{voice?.has_reference ? t("speak.labelDirection") : voice ? t("speak.labelAppend") : t("speak.labelDesign")}</label>
                  <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder={voice?.has_reference ? t("speak.placeholderDirection") : t("speak.placeholderDesign")} />
                </div>
              </div>
              <div className="hint">
                {voice?.has_reference
                  ? t("speak.hintClone", { name: voice.name })
                  : voice
                    ? t("speak.hintDescribed", { name: voice.name })
                    : t("speak.hintDefault")}
              </div>
            </div>
            <ParamsPanel value={params} onChange={setParams} />
            <div className="hstack">
              {busy && mode === "stream" ? (
                <button className="btn lg" onClick={() => stopRef.current()}><Square size={13} fill="currentColor" />{t("common.stop")}</button>
              ) : (
                <button className="btn lg primary" disabled={busy || !text.trim() || engine?.state !== "ready"} onClick={run}>
                  {busy ? <Spinner /> : <AudioLines size={16} />}{t("speak.speak")}
                </button>
              )}
              <div className="wave" style={{ flex: 1, height: 34, color: voice?.color ?? "var(--accent)" }}>
                {level.map((l, i) => <span key={i} style={{ height: `${Math.max(6, l * 260)}%` }} />)}
              </div>
              {ttfa !== null && <span className="badge green">{t("speak.firstPacket", { ms: Math.round(ttfa) })}</span>}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>{t("speak.recent")}</div>
            <div className="group">
              {clips.length === 0 && <div className="row muted small">{t("speak.recentEmpty")}</div>}
              {clips.map((c) => (
                <div className="row" key={c.id} style={{ alignItems: "flex-start" }}>
                  <PlayButton track={{ key: `clip-${c.id}`, url: c.url, title: t("speak.clipTitle"), subtitle: c.text }} />
                  <div className="grow">
                    <div className="small" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.text}</div>
                    <div className="hint hstack" style={{ gap: 6 }}>
                      <Duration ms={c.duration_ms} /> · seed {c.seed}
                    </div>
                  </div>
                  <div className="hstack" style={{ gap: 0 }}>
                    <button className="btn icon plain" title={t("speak.copyParams")} onClick={() => { setText(c.text); setInstruct(c.instruct); setParams({ ...c.params, seed: c.seed }); setVoiceId(c.voice_id); }}><Copy size={13} /></button>
                    <button className="btn icon plain" title={t("speak.saveAsVoice")} onClick={() => setSaveClip(c)}><UserPlus size={13} /></button>
                    <button className="btn icon plain" title={t("speak.deleteClip")} onClick={async () => { await del(`/clips/${c.id}`).catch(fail); void loadClips(); }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {saveClip && <SaveClipAsVoice clip={saveClip} onClose={() => setSaveClip(null)} />}
    </>
  );
}
