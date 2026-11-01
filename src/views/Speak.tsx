import { useEffect, useRef, useState } from "react";
import { AudioLines, Copy, Square, Trash2, UserPlus, Zap } from "lucide-react";
import { del, get, isZh, post, streamSpeech, type Clip, type Params } from "../api";
import { PcmStreamPlayer } from "../audio";
import { usePlayer, useStore } from "../store";
import { Duration, EventChips, ParamsPanel, PlayButton, Segmented, Sheet, Spinner, VoiceSelect } from "../ui";

const SAMPLE = "[笑] 欢迎来到今晚的节目。今天我们聊一个有点烧脑、但又特别有意思的话题：声音，到底是怎么被“设计”出来的？";

export function SaveClipAsVoice({ clip, onClose, defaultInstruct = "" }: { clip: Clip; onClose: () => void; defaultInstruct?: string }) {
  const { fail, toast, go } = useStore();
  const [name, setName] = useState("");
  const [instruct, setInstruct] = useState(defaultInstruct || clip.instruct);
  const save = async () => {
    try {
      await post("/voices", { name, instruct, description: clip.instruct, from_clip_id: clip.id, language: isZh(clip.text) ? "zh" : "en" });
      toast(`已保存声音“${name}”`);
      onClose();
      go({ name: "voices" });
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet
      title="保存为声音"
      subtitle="这条音频会作为参考样本，之后用它生成的每一句都保持同一个嗓音。"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>保存</button>
        </>
      }
    >
      <div className="vstack">
        <div className="field">
          <label>名称（也是脚本里的角色名）</label>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：主持人 / 老周" />
        </div>
        <div className="field">
          <label>默认演绎指导（可选）</label>
          <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder="没有单句指导时使用" />
        </div>
      </div>
    </Sheet>
  );
}

export function SpeakView() {
  const { voices, fail, engine } = useStore();
  const player = usePlayer();
  const [text, setText] = useState(SAMPLE);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [instruct, setInstruct] = useState("一位语气亲切、表达清晰的年轻女主播，语速适中。");
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
        player.play({ key: `clip-${clip.id}`, url: clip.url, title: "即时朗读", subtitle: clip.text, color: voice?.color });
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
        <h1>即时朗读</h1>
        <span className="sub">任意文本 → 语音，支持声音设计、克隆与演绎指导</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={mode} onChange={setMode} options={[{ value: "stream", label: <><Zap size={12} /> 实时流式</> }, { value: "offline", label: "整段生成" }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            <div className="card pad">
              <textarea ref={ta} className="textarea" style={{ minHeight: 170, fontSize: 16, background: "none", boxShadow: "none", padding: 0 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入要朗读的文字…" />
              <div className="hstack" style={{ marginTop: 10, flexWrap: "wrap" }}>
                <EventChips target={ta} value={text} onChange={setText} lang={zh ? "zh" : "en"} />
                <span style={{ flex: 1 }} />
                <span className="hint">{text.length} 字</span>
              </div>
            </div>
            <div className="card pad vstack">
              <div className="grid cols-2">
                <div className="field">
                  <label>声音</label>
                  <VoiceSelect voices={voices} value={voiceId} onChange={setVoiceId} allowNone noneLabel="无参考 · 按描述现场设计" />
                </div>
                <div className="field">
                  <label>{voice?.has_reference ? "演绎指导（Voice Direction）" : voice ? "追加描述" : "声音描述（Voice Design）"}</label>
                  <input className="input" value={instruct} onChange={(e) => setInstruct(e.target.value)} placeholder={voice?.has_reference ? "例如：语速放慢，语气严肃克制" : "例如：一位温暖沉稳的中年男声"} />
                </div>
              </div>
              <div className="hint">
                {voice?.has_reference
                  ? `将克隆“${voice.name}”的音色，并按指导调整情绪、语气与节奏。`
                  : voice
                    ? `“${voice.name}”是描述型声音，每次生成的嗓音会略有不同；在声音设计里把满意的一条保存下来即可固定。`
                    : "描述语言建议与文本一致（中文文本用中文描述）。"}
              </div>
            </div>
            <ParamsPanel value={params} onChange={setParams} />
            <div className="hstack">
              {busy && mode === "stream" ? (
                <button className="btn lg" onClick={() => stopRef.current()}><Square size={13} fill="currentColor" />停止</button>
              ) : (
                <button className="btn lg primary" disabled={busy || !text.trim() || engine?.state !== "ready"} onClick={run}>
                  {busy ? <Spinner /> : <AudioLines size={16} />}朗读
                </button>
              )}
              <div className="wave" style={{ flex: 1, height: 34, color: voice?.color ?? "var(--accent)" }}>
                {level.map((l, i) => <span key={i} style={{ height: `${Math.max(6, l * 260)}%` }} />)}
              </div>
              {ttfa !== null && <span className="badge green">首包 {Math.round(ttfa)} ms</span>}
            </div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>最近生成</div>
            <div className="group">
              {clips.length === 0 && <div className="row muted small">生成的音频会出现在这里</div>}
              {clips.map((c) => (
                <div className="row" key={c.id} style={{ alignItems: "flex-start" }}>
                  <PlayButton track={{ key: `clip-${c.id}`, url: c.url, title: "即时朗读", subtitle: c.text }} />
                  <div className="grow">
                    <div className="small" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{c.text}</div>
                    <div className="hint hstack" style={{ gap: 6 }}>
                      <Duration ms={c.duration_ms} /> · seed {c.seed}
                    </div>
                  </div>
                  <div className="hstack" style={{ gap: 0 }}>
                    <button className="btn icon plain" title="复制参数（含种子）" onClick={() => { setText(c.text); setInstruct(c.instruct); setParams({ ...c.params, seed: c.seed }); setVoiceId(c.voice_id); }}><Copy size={13} /></button>
                    <button className="btn icon plain" title="保存为声音" onClick={() => setSaveClip(c)}><UserPlus size={13} /></button>
                    <button className="btn icon plain" title="删除" onClick={async () => { await del(`/clips/${c.id}`).catch(fail); void loadClips(); }}><Trash2 size={13} /></button>
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
