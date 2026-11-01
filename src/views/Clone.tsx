import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, UserPlus, Wand2 } from "lucide-react";
import { fileToBase64, isZh, post, type Clip, type Voice } from "../api";
import { WavRecorder } from "../audio";
import { usePlayer, useStore } from "../store";
import { Segmented, Spinner } from "../ui";

const READ_ALOUD = {
  zh: "今天的天气很好，阳光透过窗户洒进房间。我泡了一杯茶，打开电脑，准备开始录制新一期的节目。说实话，每次开口之前，我都还是会有一点点紧张。",
  en: "The weather is lovely today, and sunlight is pouring through the window. I made a cup of tea, opened my laptop, and got ready to record a new episode. Honestly, I still get a little nervous every time.",
};

export function CloneView() {
  const { fail, toast, go, engine } = useStore();
  const player = usePlayer();
  const [source, setSource] = useState<"record" | "file">("record");
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [name, setName] = useState("");
  const [instruct, setInstruct] = useState("");
  const [testText, setTestText] = useState("大家好，这是用我的声音生成的一段测试语音，听起来像我吗？");
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
      fail(`无法访问麦克风：${e instanceof Error ? e.message : e}`);
    }
  };
  const stopRec = async () => {
    const r = rec.current;
    rec.current = null;
    setRecording(false);
    if (!r) return;
    const b = await r.stop();
    setBlob(b);
    setFileName("录音.wav");
    if (!transcript.trim()) setTranscript(READ_ALOUD[lang]);
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
      player.play({ key: `clip-${clip.id}`, url: clip.url, title: "克隆试听", subtitle: testText });
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
      toast(`已保存声音“${v.name}”`);
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
        <h1>声音克隆</h1>
        <span className="sub">3–20 秒清晰人声 + 准确逐字稿</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={source} onChange={setSource} options={[{ value: "record", label: <><Mic size={12} /> 跟读录音</> }, { value: "file", label: <><Upload size={12} /> 导入音频</> }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            {source === "record" ? (
              <div className="card pad vstack">
                <div className="hstack">
                  <span className="label" style={{ flex: 1 }}>请用自然的语气朗读下面这段话</span>
                  <Segmented value={lang} onChange={(l) => { setLang(l); if (!audio) setTranscript(""); }} options={[{ value: "zh", label: "中文" }, { value: "en", label: "EN" }]} />
                </div>
                <div style={{ fontSize: 17, lineHeight: 1.75, padding: "6px 2px", fontFamily: "var(--font-display)" }}>{READ_ALOUD[lang]}</div>
                <div className="hstack">
                  {recording ? (
                    <button className="btn lg" onClick={stopRec}><Square size={13} fill="var(--red)" color="var(--red)" />完成</button>
                  ) : (
                    <button className="btn lg primary" onClick={startRec}><Mic size={16} />{audio ? "重新录制" : "开始录音"}</button>
                  )}
                  {recording && <span className="rec-dot" />}
                  {recording && <span className="mono">{elapsed.toFixed(1)}s</span>}
                  <div className="meter" style={{ flex: 1 }}><div style={{ width: `${Math.min(100, level * 140)}%` }} /></div>
                </div>
                <div className="hint">在安静的环境中录制，距离麦克风约一拳，避免音乐和回声。录音结束后逐字稿会自动填入，如有口误请修改。</div>
              </div>
            ) : (
              <label
                className={`drop ${over ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); }}
              >
                <Upload size={26} style={{ marginBottom: 8, color: "var(--accent)" }} />
                <div style={{ fontWeight: 600, color: "var(--fg)" }}>拖入音频文件，或点击选择</div>
                <div className="hint">支持 WAV / MP3 / M4A / AIFF / FLAC，会自动转换为 24 kHz 单声道</div>
                <input type="file" accept="audio/*,.wav,.mp3,.m4a,.aiff,.flac" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
            )}
            {audio && (
              <div className="card pad vstack">
                <div className="hstack">
                  <span className="label" style={{ flex: 1 }}>参考音频 · {fileName}</span>
                </div>
                <audio src={audioUrl.current} controls style={{ width: "100%", height: 34 }} />
                <div className="field">
                  <label>逐字稿（必须与音频内容一字不差）</label>
                  <textarea className="textarea" style={{ minHeight: 80 }} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="把参考音频里说的每一个字写下来…" />
                </div>
              </div>
            )}
          </div>
          <div className="vstack">
            <div className="card pad vstack">
              <div className="field">
                <label>名称（也是脚本里的角色名）</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我自己 / 嘉宾 A" />
              </div>
              <div className="field">
                <label>默认演绎指导（可选）</label>
                <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder="例如：语气轻松自然，像和朋友聊天" />
                <div className="hint">克隆保留音色，指导控制情绪、语气与节奏（Voice Direction）。</div>
              </div>
              <div className="field">
                <label>试听文本</label>
                <textarea className="textarea" style={{ minHeight: 64 }} value={testText} onChange={(e) => setTestText(e.target.value)} />
              </div>
              <label className="hstack small" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
                <span className="muted">我确认这是我本人的声音，或已获得声音所有者的明确授权，不会用于冒充、欺诈等用途。</span>
              </label>
              <div className="hstack">
                <button className="btn" disabled={!ready || !!busy || engine?.state !== "ready"} onClick={test}>
                  {busy === "test" ? <Spinner /> : <Wand2 size={14} />}试听克隆效果
                </button>
                <span style={{ flex: 1 }} />
                <button className="btn primary" disabled={!ready || !name.trim() || !!busy} onClick={save}>
                  {busy === "save" ? <Spinner /> : <UserPlus size={14} />}保存声音
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
