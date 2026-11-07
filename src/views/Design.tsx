import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, UserPlus, Wand2 } from "lucide-react";
import { post, type Clip, type Params } from "../api";
import { TRAITS } from "../i18n/content";
import { defaultContentLang, sampleText, type ContentLang } from "../i18n";
import { useStore } from "../store";
import { Duration, ParamsPanel, PlayButton, Segmented, Spinner, Waveform } from "../ui";
import { SaveClipAsVoice } from "./Speak";

type Take = { clip: Clip; instruct: string };

export function DesignView() {
  const { t } = useTranslation();
  const { fail, engine } = useStore();
  const [lang, setLang] = useState<ContentLang>(defaultContentLang);
  const [desc, setDesc] = useState(() => sampleText("designDescription", defaultContentLang()));
  const [text, setText] = useState(() => sampleText("designText", defaultContentLang()));
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
    setText(sampleText("designText", l));
    setDesc(sampleText("designDescription", l));
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
        <h1>{t("design.title")}</h1>
        <span className="sub">{t("design.subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
        <Segmented value={lang} onChange={switchLang} options={[{ value: "zh", label: t("common.contentLanguage.zh") }, { value: "en", label: t("common.contentLanguage.en") }]} />
      </div>
      <div className="content">
        <div className="page" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <div className="vstack">
            <div className="card pad vstack">
              <div className="field">
                <label>{t("design.description")}</label>
                <textarea className="textarea" style={{ minHeight: 96 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
                <div className="hint">{t("design.descriptionHint")}</div>
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
                <label>{t("design.previewText")}</label>
                <textarea className="textarea" style={{ minHeight: 70 }} value={text} onChange={(e) => setText(e.target.value)} />
                <div className="hint">{t("design.previewHint")}</div>
              </div>
              <div className="hstack">
                <span className="label">{t("design.perRun")}</span>
                <Segmented value={String(count)} onChange={(v) => setCount(Number(v))} options={["1", "2", "3", "4"].map((v) => ({ value: v, label: t("design.takes", { count: Number(v) }) }))} />
              </div>
            </div>
            <ParamsPanel value={params} onChange={setParams} />
            <button className="btn lg primary" disabled={pending > 0 || !desc.trim() || !text.trim() || engine?.state !== "ready"} onClick={generate}>
              {pending ? <Spinner /> : <Wand2 size={16} />}
              {pending ? t("design.generating", { count: pending }) : t("design.generate", { count })}
            </button>
          </div>
          <div className="vstack">
            {takes.length === 0 && pending === 0 && (
              <div className="card pad" style={{ textAlign: "center", padding: "44px 26px" }}>
                <div className="empty" style={{ padding: 0 }}>
                  <div className="ico"><Sparkles size={28} /></div>
                  <h3>{t("design.emptyTitle")}</h3>
                  <p>{t("design.emptyBody")}</p>
                </div>
              </div>
            )}
            {Array.from({ length: pending }).map((_, i) => (
              <div key={`p${i}`} className="card take" style={{ opacity: 0.6 }}><Spinner /><span className="muted">{t("design.pending")}</span></div>
            ))}
            {takes.map((tk, i) => (
              <div key={tk.clip.id} className="card" style={{ padding: 14 }}>
                <div className="hstack" style={{ marginBottom: 8 }}>
                  <PlayButton track={{ key: `clip-${tk.clip.id}`, url: tk.clip.url, title: t("design.take", { n: takes.length - i }), subtitle: tk.instruct }} size="md" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{t("design.take", { n: takes.length - i })}</div>
                    <div className="hint ellipsis">{tk.instruct}</div>
                  </div>
                  <Duration ms={tk.clip.duration_ms} />
                  <span className="badge">{t("design.seed", { seed: tk.clip.seed })}</span>
                  <button className="btn sm primary" onClick={() => setSave(tk)}><UserPlus size={13} />{t("design.saveAsVoice")}</button>
                </div>
                <Waveform url={tk.clip.url} />
              </div>
            ))}
          </div>
        </div>
      </div>
      {save && <SaveClipAsVoice clip={save.clip} defaultInstruct="" onClose={() => setSave(null)} />}
    </>
  );
}
