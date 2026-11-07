import { useState } from "react";
import { Mic, Pencil, Play, Trash2, Users, Wand2 } from "lucide-react";
import { del, patch, post, type Clip, type Voice } from "../api";
import { useTranslation } from "react-i18next";
import { usePlayer, useStore } from "../store";
import { Avatar, Empty, ParamsPanel, PlayButton, Sheet, Spinner } from "../ui";

const COLORS = ["#0A84FF", "#5E5CE6", "#BF5AF2", "#FF375F", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#AC8E68"];

function EditVoice({ voice, onClose }: { voice: Voice; onClose: () => void }) {
  const { t } = useTranslation();
  const { fail } = useStore();
  const [v, setV] = useState(voice);
  const save = async () => {
    try {
      await patch(`/voices/${voice.id}`, { name: v.name, description: v.description, instruct: v.instruct, ref_text: v.ref_text ?? undefined, color: v.color, language: v.language, params: v.params });
      onClose();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet title={t("voices.edit.title", { name: voice.name })} width={680} onClose={onClose} actions={<><button className="btn" onClick={onClose}>{t("common.cancel")}</button><button className="btn primary" onClick={save}>{t("common.save")}</button></>}>
      <div className="vstack">
        <div className="grid cols-2">
          <div className="field"><label>{t("voices.edit.name")}</label><input className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div className="field">
            <label>{t("voices.edit.color")}</label>
            <div className="chips" style={{ paddingTop: 5 }}>
              {COLORS.map((c) => <button key={c} onClick={() => setV({ ...v, color: c })} style={{ width: 22, height: 22, borderRadius: "50%", border: 0, background: c, boxShadow: c === v.color ? `0 0 0 2px var(--content), 0 0 0 4px ${c}` : "none" }} />)}
            </div>
          </div>
        </div>
        <div className="field">
          <label>{v.has_reference ? t("voices.edit.direction") : t("voices.edit.description")}</label>
          <textarea className="textarea" style={{ minHeight: 60 }} value={v.instruct} onChange={(e) => setV({ ...v, instruct: e.target.value })} />
        </div>
        {v.has_reference && (
          <div className="field">
            <label>{t("voices.edit.refText")}</label>
            <textarea className="textarea" style={{ minHeight: 60 }} value={v.ref_text ?? ""} onChange={(e) => setV({ ...v, ref_text: e.target.value })} />
          </div>
        )}
        <div className="field"><label>{t("voices.edit.notes")}</label><input className="input" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
        <div className="label">{t("voices.edit.params")}</div>
        <ParamsPanel value={v.params} onChange={(params) => setV({ ...v, params })} />
      </div>
    </Sheet>
  );
}

function VoiceCard({ v }: { v: Voice }) {
  const { t } = useTranslation();
  const { fail, episodes } = useStore();
  const player = usePlayer();
  const [edit, setEdit] = useState(false);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const used = episodes.filter((e) => e.cast.some((c) => c.voice_id === v.id)).length;
  const preview = async () => {
    setBusy(true);
    try {
      const clip = await post<Clip>(`/voices/${v.id}/preview`, { direction });
      player.play({ key: `clip-${clip.id}`, url: clip.url, title: v.name, subtitle: clip.text, color: v.color });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="hstack" style={{ gap: 12 }}>
        <Avatar voice={v} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 15 }} className="ellipsis">{v.name}</div>
          <div className="hstack" style={{ gap: 5 }}>
            <span className={`badge ${v.has_reference ? "accent" : "orange"}`}>{t(`voices.source.${v.source}`)}</span>
            {!v.has_reference && <span className="badge" title={t("voices.describedHint")}>{t("voices.describedBadge")}</span>}
            {used > 0 && <span className="hint">{t("voices.usedIn", { count: used })}</span>}
          </div>
        </div>
        {v.ref_url && <PlayButton track={{ key: `ref-${v.id}`, url: v.ref_url, title: t("voices.refTitle", { name: v.name }), subtitle: v.ref_text ?? "", color: v.color }} />}
        <button className="btn icon plain" onClick={() => setEdit(true)} title={t("common.edit")}><Pencil size={14} /></button>
        <button className="btn icon plain" title={t("common.delete")} onClick={async () => { if (confirm(t("voices.deleteConfirm", { name: v.name }))) await del(`/voices/${v.id}`).catch(fail); }}><Trash2 size={14} /></button>
      </div>
      {v.instruct && <div className="small muted" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v.instruct}</div>}
      <div className="hstack">
        <input className="input" style={{ height: 28, fontSize: 12 }} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder={v.has_reference ? t("voices.previewPlaceholderRef") : t("voices.previewPlaceholderDesc")} onKeyDown={(e) => e.key === "Enter" && preview()} />
        <button className="btn sm" disabled={busy} onClick={preview}>{busy ? <Spinner /> : <Play size={11} fill="currentColor" />}{t("voices.preview")}</button>
      </div>
      {edit && <EditVoice voice={v} onClose={() => setEdit(false)} />}
    </div>
  );
}

export function VoicesView() {
  const { t } = useTranslation();
  const { voices, go } = useStore();
  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("voices.title")}</h1>
        <span className="sub">{t("voices.subtitle", { count: voices.length })}</span>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => go({ name: "clone" })}><Mic size={14} />{t("voices.clone")}</button>
        <button className="btn primary" onClick={() => go({ name: "design" })}><Wand2 size={14} />{t("voices.design")}</button>
      </div>
      <div className="content">
        <div className="page">
          {voices.length === 0 ? (
            <Empty icon={<Users size={30} />} title={t("voices.emptyTitle")} action={<div className="hstack" style={{ justifyContent: "center" }}><button className="btn" onClick={() => go({ name: "clone" })}>{t("voices.clone")}</button><button className="btn primary" onClick={() => go({ name: "design" })}>{t("voices.design")}</button></div>}>
              {t("voices.emptyBody")}
            </Empty>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
              {voices.map((v) => <VoiceCard key={v.id} v={v} />)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
