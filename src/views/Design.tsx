import { useState } from "react";
import { Sparkles, UserPlus, Wand2 } from "lucide-react";
import { post, type Clip, type Params } from "../api";
import { useStore } from "../store";
import { Duration, ParamsPanel, PlayButton, Segmented, Spinner, Waveform } from "../ui";
import { SaveClipAsVoice } from "./Speak";

const TRAITS = {
  zh: [
    { group: "性别年龄", items: ["年轻女性", "成熟女性", "年轻男性", "中年男性", "少年", "老奶奶", "老爷爷"] },
    { group: "音色", items: ["声音清亮", "低沉有磁性", "温暖柔和", "略带沙哑", "甜美", "浑厚有力", "气声明显"] },
    { group: "风格", items: ["播客主持风格", "专业播音腔", "亲切像朋友聊天", "知性冷静", "活泼俏皮", "慵懒随性", "沉稳可靠"] },
    { group: "节奏", items: ["语速适中", "语速偏慢，停顿自然", "语速较快，充满活力"] },
    { group: "口音", items: ["标准普通话", "略带台湾腔", "略带东北口音", "略带粤语口音"] },
  ],
  en: [
    { group: "Who", items: ["A young woman", "A mature woman", "A young man", "A middle-aged man", "A teenager", "An elderly woman", "An elderly man"] },
    { group: "Timbre", items: ["with a bright, clear voice", "with a deep, resonant voice", "with a warm, soft voice", "with a slightly raspy voice", "with a rich, powerful voice", "breathy"] },
    { group: "Style", items: ["podcast host style", "polished broadcaster", "friendly and conversational", "calm and intellectual", "playful and bubbly", "laid-back"] },
    { group: "Pace", items: ["moderate pace", "slow, with natural pauses", "fast-paced and energetic"] },
    { group: "Accent", items: ["American accent", "British accent", "Australian accent"] },
  ],
};

const SAMPLE_TEXT = {
  zh: "大家好，欢迎收听本期节目。今天想和你聊聊，那些藏在日常生活里的小小惊喜。",
  en: "Hi everyone, welcome back to the show. Today I want to talk about the small surprises hiding in everyday life.",
};

type Take = { clip: Clip; instruct: string };

export function DesignView() {
  const { fail, engine } = useStore();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [desc, setDesc] = useState("一位温暖亲切的年轻女性，声音清亮，播客主持风格，语速适中。");
  const [text, setText] = useState(SAMPLE_TEXT.zh);
  const [count, setCount] = useState(3);
  const [params, setParams] = useState<Params>({ guidance_scale: 4 });
  const [takes, setTakes] = useState<Take[]>([]);
  const [pending, setPending] = useState(0);
  const [save, setSave] = useState<Take | null>(null);

  const toggleTrait = (t: string) => {
    const sep = lang === "zh" ? "，" : ", ";
    const parts = desc.replace(/[。.]$/, "").split(/[，,]\s*/).filter(Boolean);
    const next = parts.includes(t) ? parts.filter((p) => p !== t) : [...parts, t];
    setDesc(next.join(sep) + (next.length ? (lang === "zh" ? "。" : ".") : ""));
  };
  const switchLang = (l: "zh" | "en") => {
    setLang(l);
    setText(SAMPLE_TEXT[l]);
    setDesc(l === "zh" ? "一位温暖亲切的年轻女性，声音清亮，播客主持风格，语速适中。" : "A young woman, with a warm, soft voice, friendly and conversational, moderate pace.");
  };
  const generate = async () => {
    setPending(count);
    const instruct = desc;
    for (let i = 0; i < count; i++) {
      try {
        const r = await post<{ takes: Clip[] }>("/voices/audition", { instruct, text, count: 1, params: { ...params, seed: params.seed !== undefined ? params.seed + i : undefined } });
        setTakes((t) => [{ clip: r.takes[0], instruct }, ...t]);
      } catch (e) {
        fail(e);
        break;
      } finally {
        setPending((p) => p - 1);
      }
    }
    setPending(0);
  };

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>声音设计</h1>
        <span className="sub">用一句话描述，凭空创造一个声音</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={lang} onChange={switchLang} options={[{ value: "zh", label: "中文" }, { value: "en", label: "English" }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            <div className="card pad vstack">
              <div className="field">
                <label>声音描述</label>
                <textarea className="textarea" style={{ minHeight: 96 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
                <div className="hint">描述语言与试听文本保持一致效果最好。可以描述年龄、性别、音色、情绪、语速、口音和使用场景。</div>
              </div>
              {TRAITS[lang].map((g) => (
                <div key={g.group}>
                  <div className="hint" style={{ marginBottom: 6 }}>{g.group}</div>
                  <div className="chips">
                    {g.items.map((t) => (
                      <button key={t} className={`chip ${desc.includes(t) ? "on" : ""}`} onClick={() => toggleTrait(t)}>{t}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="card pad vstack">
              <div className="field">
                <label>试听文本</label>
                <textarea className="textarea" style={{ minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="hint">保存后，这段文本会成为该声音的参考逐字稿，建议 10–20 秒的自然口语，不要加声音事件。</div>
              </div>
              <div className="hstack">
                <span className="label">每次生成</span>
                <Segmented value={String(count)} onChange={(v) => setCount(Number(v))} options={["1", "2", "3", "4"].map((v) => ({ value: v, label: `${v} 版` }))} />
              </div>
            </div>
            <ParamsPanel value={params} onChange={setParams} />
            <button className="btn lg primary" disabled={pending > 0 || !desc.trim() || !text.trim() || engine?.state !== "ready"} onClick={generate}>
              {pending ? <Spinner /> : <Wand2 size={16} />}
              {pending ? `正在生成，还剩 ${pending} 版…` : `生成 ${count} 个候选声音`}
            </button>
          </div>
          <div className="vstack">
            {takes.length === 0 && pending === 0 && (
              <div className="card pad" style={{ textAlign: "center", padding: "44px 26px" }}>
                <div className="empty" style={{ padding: 0 }}>
                  <div className="ico"><Sparkles size={28} /></div>
                  <h3>挑出你最喜欢的那一版</h3>
                  <p>BreezeTTS 2 每次按描述生成的嗓音都略有不同。多生成几版，把最满意的“保存为声音”，它就会作为参考样本固定下来，在整季节目里保持同一个人。</p>
                </div>
              </div>
            )}
            {Array.from({ length: pending }).map((_, i) => (
              <div key={`p${i}`} className="card take" style={{ opacity: 0.6 }}><Spinner /><span className="muted">生成中…</span></div>
            ))}
            {takes.map((t, i) => (
              <div key={t.clip.id} className="card" style={{ padding: 14 }}>
                <div className="hstack" style={{ marginBottom: 8 }}>
                  <PlayButton track={{ key: `clip-${t.clip.id}`, url: t.clip.url, title: `候选 #${takes.length - i}`, subtitle: t.instruct }} size="md" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>候选 #{takes.length - i}</div>
                    <div className="hint ellipsis">{t.instruct}</div>
                  </div>
                  <Duration ms={t.clip.duration_ms} />
                  <span className="badge">seed {t.clip.seed}</span>
                  <button className="btn sm primary" onClick={() => setSave(t)}><UserPlus size={13} />保存为声音</button>
                </div>
                <Waveform url={t.clip.url} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {save && <SaveClipAsVoice clip={save.clip} defaultInstruct="" onClose={() => setSave(null)} />}
    </>
  );
}
