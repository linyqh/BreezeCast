import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Square, Upload, UserPlus, Wand2 } from "lucide-react";
import { fileToBase64, isZh, post, type Clip, type Voice } from "../api";
import { WavRecorder } from "../audio";
import { defaultContentLang, sampleText, type ContentLang } from "../i18n";
import { usePlayer, useStore } from "../store";
import { Segmented, Spinner } from "../ui";

export function CloneView() {
  const { t } = useTranslation();
  const { fail, toast, go, engine } = useStore();
  const player = usePlayer();
  const [source, setSource] = useState<"record" | "file">("record");
  const [lang, setLang] = useState<ContentLang>(defaultContentLang);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [name, setName] = useState("");
  const [instruct, setInstruct] = useState("");
  const [testText, setTestText] = useState(() => sampleText("cloneTest", defaultContentLang()));
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const rec = useRef<WavRecorder | null>(null);
  const audioUrl = useRef<string>("");
  const [consent, setConsent] = useState(false);

  useEffect(() => () => URL.revokeObjectURL(audioUrl.current), []);
  const setBlob = (b: Blob | null) => {
    URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = b ? URL.createObjectURL(b) : "";
    setAudio(b);
  };

  const startRec = async () => {
    try {
      const r = new WavRecorder();
      await r.start();
      rec.current = r;
      setRecording(true);
      setBlob(null);
      const buf = new Uint8Array(512);
      const tick = () => {
        if (!rec.current) return;
        rec.current.analyser?.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        setElapsed(rec.current.elapsed());
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      fail(t("clone.micError", { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const stopRec = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    if (!r) return;
    const b = await r.stop();
    setBlob(b);
    setFileName(t("clone.recordingName"));
    if (!transcript.trim()) setTranscript(sampleText("readAloud", lang));
  };
  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setBlob(f);
    setFileName(f.name);
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const body = async () => ({ ref_audio_base64: await fileToBase64(audio as Blob), ref_text: transcript });
  const test = async () => {
    setBusy("test");
    try {
      const clip = await post<Clip>("/speech", { ...(await body()), text: testText, instruct });
      player.play({ key: `clip-${clip.id}`, url: clip.url, title: t("clone.testTitle"), subtitle: testText });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      const v = await post<Voice>("/voices", { ...(await body()), name, instruct, source: source === "record" ? "record" : "clone", language: isZh(transcript) ? "zh" : "en" });
      toast(t("clone.saved", { name: v.name }));
      go({ name: "voices" });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const ready = !!audio && transcript.trim().length > 0 && consent;

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("clone.title")}</h1>
        <span className="sub">{t("clone.subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={source} onChange={setSource} options={[{ value: "record", label: <><Mic size={12} /> {t("clone.sourceRecord")}</> }, { value: "file", label: <><Upload size={12} /> {t("clone.sourceFile")}</> }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            {source === "record" ? (
              <div className="card pad vstack">
                <div className="hstack">
                  <span className="label" style={{ flex: 1 }}>{t("clone.readPrompt")}</span>
                  <Segmented value={lang} onChange={(l) => { setLang(l); if (!audio) setTranscript(""); }} options={[{ value: "zh", label: t("common.contentLanguage.zh") }, { value: "en", label: t("common.contentLanguage.en") }]} />
                </div>
                <div style={{ fontSize: 17, lineHeight: 1.75, padding: "6px 2px", fontFamily: "var(--font-display)" }}>{sampleText("readAloud", lang)}</div>
                <div className="hstack">
                  {recording ? (
                    <button className="btn lg" onClick={stopRec}><Square size={13} fill="var(--red)" color="var(--red)" />{t("clone.finish")}</button>
                  ) : (
                    <button className="btn lg primary" onClick={startRec}><Mic size={16} />{audio ? t("clone.rerecord") : t("clone.record")}</button>
                  )}
                  {recording && <span className="rec-dot" />}
                  {recording && <span className="mono">{elapsed.toFixed(1)}s</span>}
                  <div className="meter" style={{ flex: 1 }}><div style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
                </div>
                <div className="hint">{t("clone.recordHint")}</div>
              </div>
            ) : (
              <label
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); }}
              >
                <Upload size={26} style={{ marginBottom: 8, color: "var(--accent)" }} />
                <div style={{ fontWeight: 600, color: "var(--fg)" }}>{t("clone.drop")}</div>
                <div className="hint">{t("clone.dropHint")}</div>
                <input type="file" accept="audio/*,.wav,.mp3,.m4a,.aiff,.flac" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
            )}
            {audio && (
              <div className="card pad vstack">
                <div className="hstack">
                  <span className="label" style={{ flex: 1 }}>{t("clone.reference", { file: fileName })}</span>
                </div>
                <audio src={audioUrl.current} controls style={{ width: "100%", height: 34 }} />
                <div className="field">
                  <label>{t("clone.transcript")}</label>
                  <textarea className="textarea" style={{ minHeight: 80 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={t("clone.transcriptPlaceholder")} />
                </div>
              </div>
            )}
          </div>
          <div className="vstack">
            <div className="card pad vstack">
              <div className="field">
                <label>{t("clone.name")}</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("clone.namePlaceholder")} />
              </div>
              <div className="field">
                <label>{t("clone.instruct")}</label>
                <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder={t("clone.instructPlaceholder")} />
                <div className="hint">{t("clone.instructHint")}</div>
              </div>
              <div className="field">
                <label>{t("clone.testText")}</label>
                <textarea className="textarea" style={{ minHeight: 64 }} value={testText} onChange={(e) => setTestText(e.target.value)} />
              </div>
              <label className="hstack small" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span className="muted">{t("clone.consent")}</span>
              </label>
              <div className="hstack">
                <button className="btn" disabled={!ready || !!busy || engine?.state !== "ready"} onClick={test}>
                  {busy === "test" ? <Spinner /> : <Wand2 size={14} />}{t("clone.test")}
                </button>
                <span style={{ flex: 1 }} />
                <button className="btn primary" disabled={!ready || !name.trim() || !!busy} onClick={save}>
                  {busy === "save" ? <Spinner /> : <UserPlus size={14} />}{t("clone.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
