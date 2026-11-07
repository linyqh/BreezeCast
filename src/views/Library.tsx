import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { FilePlus2, Library, Plus, Radio, Trash2 } from "lucide-react";
import { del, patch, post, type Episode, type Show } from "../api";
import { defaultContentLang, sampleText } from "../i18n";
import { useStore } from "../store";
import { Duration, Empty, PlayButton, Sheet, coverStyle } from "../ui";

const SHOW_COLORS = ["#5E5CE6", "#0A84FF", "#BF5AF2", "#FF375F", "#FF9F0A", "#30D158", "#64D2FF", "#AC8E68"];


const STATUS_BADGE_CLASS: Record<Episode["status"], string> = {
  draft: "",
  rendering: "accent",
  rendered: "green",
  stale: "orange",
  failed: "red",
};

export function StatusBadge({ status }: { status: Episode["status"] }) {
  const { t } = useTranslation();
  return <span className={`badge ${STATUS_BADGE_CLASS[status]}`}>{t(`library.status.${status}`)}</span>;
}

export function NewShowSheet({ onClose, show }: { onClose: () => void; show?: Show }) {
  const { t } = useTranslation();
  const { go, fail } = useStore();
  const [title, setTitle] = useState(show?.title ?? "");
  const [description, setDescription] = useState(show?.description ?? "");
  const [author, setAuthor] = useState(show?.author ?? "");
  const [color, setColor] = useState(show?.color ?? SHOW_COLORS[0]);
  const save = async () => {
    try {
      const body = { title, description, author, color };
      if (show) await patch(`/shows/${show.id}`, body);
      else {
        const s = await post<Show>("/shows", body);
        go({ name: "show", id: s.id });
      }
      onClose();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Sheet
      title={show ? t("library.showSheet.titleEdit") : t("library.showSheet.titleNew")}
      subtitle={t("library.showSheet.subtitle")}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>{show ? t("common.save") : t("common.create")}</button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 18 }}>
        <div className="cover" style={coverStyle(color)}>
          <div className="t">{title || t("library.showSheet.coverPlaceholder")}</div>
        </div>
        <div className="vstack">
          <div className="field">
            <label>{t("library.showSheet.name")}</label>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("library.showSheet.namePlaceholder")} />
          </div>
          <div className="field">
            <label>{t("library.showSheet.author")}</label>
            <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="chips">
            {SHOW_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 22, height: 22, borderRadius: "50%", border: 0, background: c, boxShadow: c === color ? `0 0 0 2px var(--content), 0 0 0 4px ${c}` : "none" }} />
            ))}
          </div>
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>{t("library.showSheet.description")}</label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 70 }} />
      </div>
    </Sheet>
  );
}

export function NewEpisodeSheet({ onClose, showId }: { onClose: () => void; showId?: string | null }) {
  const { t } = useTranslation();
  const { go, fail, shows } = useStore();
  const [title, setTitle] = useState("");
  const [show, setShow] = useState<string>(showId ?? "");
  const [script, setScript] = useState(() => sampleText("scriptTemplate", defaultContentLang()));
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const ep = await post<Episode>("/episodes", { title: title || t("library.episodeSheet.untitled"), show_id: show || null, script });
      onClose();
      go({ name: "episode", id: ep.id });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={t("library.episodeSheet.title")}
      subtitle={t("library.episodeSheet.subtitle")}
      width={680}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t("common.cancel")}</button>
          <button className="btn primary" disabled={busy} onClick={create}>{t("library.episodeSheet.create")}</button>
        </>
      }
    >
      <div className="grid cols-2">
        <div className="field">
          <label>{t("library.episodeSheet.fieldTitle")}</label>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("library.episodeSheet.titlePlaceholder")} />
        </div>
        <div className="field">
          <label>{t("library.episodeSheet.show")}</label>
          <select className="input" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="">{t("library.episodeSheet.standalone")}</option>
            {shows.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>{t("library.episodeSheet.script")}</label>
        <textarea className="textarea mono" style={{ minHeight: 220, fontSize: 13 }} value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="hint">
          <Trans
            i18nKey="library.episodeSheet.hint"
            components={{
              line: <span className="kbd">{t("library.episodeSheet.kbdLine")}</span>,
              direction: <span className="kbd">{t("library.episodeSheet.kbdDirection")}</span>,
              pause: <span className="kbd">{"<pause 1.5s>"}</span>,
              zhTag: <span className="kbd">[笑]</span>,
              enTag: <span className="kbd">(laugh)</span>,
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}

function EpisodeRow({ ep }: { ep: Episode }) {
  const { t } = useTranslation();
  const { go, shows, fail } = useStore();
  const show = shows.find((s) => s.id === ep.show_id);
  return (
    <div className="row" style={{ cursor: "pointer" }} onClick={() => go({ name: "episode", id: ep.id })}>
      {ep.audio ? (
        <PlayButton track={{ key: `ep-${ep.id}-${ep.audio.rendered_at}`, url: ep.audio.url, title: ep.title, subtitle: show?.title, color: show?.color }} />
      ) : (
        <div className="btn icon plain" style={{ opacity: 0.35 }}><Radio size={15} /></div>
      )}
      <div className="grow">
        <div className="title ellipsis">{ep.title}</div>
        <div className="desc">
          {t("library.row.summary", { lines: ep.line_count ?? 0, count: ep.cast.length })} {show ? `· ${show.title}` : ""}
        </div>
      </div>
      <StatusBadge status={ep.status} />
      {ep.audio && <Duration ms={ep.audio.duration_ms} />}
      <button
        className="btn icon plain"
        title={t("library.row.deleteTitle")}
        onClick={async (e) => {
          e.stopPropagation();
          if (!confirm(t("library.row.deleteConfirm", { title: ep.title }))) return;
          await del(`/episodes/${ep.id}`).catch(fail);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function LibraryView() {
  const { t } = useTranslation();
  const { shows, episodes, go } = useStore();
  const [newShow, setNewShow] = useState(false);
  const [newEp, setNewEp] = useState(false);
  const standalone = episodes.filter((e) => !e.show_id);
  const recent = [...episodes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("library.title")}</h1>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => setNewShow(true)}><Plus size={15} />{t("library.newShow")}</button>
        <button className="btn primary" onClick={() => setNewEp(true)}><FilePlus2 size={15} />{t("library.newEpisode")}</button>
      </div>
      <div className="content">
        <div className="page">
          {shows.length === 0 && episodes.length === 0 ? (
            <Empty
              icon={<Library size={30} />}
              title={t("library.empty.title")}
              action={<div className="hstack" style={{ justifyContent: "center" }}><button className="btn" onClick={() => setNewShow(true)}>{t("library.newShow")}</button><button className="btn primary" onClick={() => setNewEp(true)}>{t("library.empty.writeScript")}</button></div>}
            >
              {t("library.empty.body")}
            </Empty>
          ) : (
            <>
              {shows.length > 0 && (
                <div className="grid auto" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 22 }}>
                  {shows.map((s) => (
                    <button key={s.id} className="show-card" onClick={() => go({ name: "show", id: s.id })}>
                      <div className="cover" style={coverStyle(s.color)}>
                        <div className="t">{s.title}</div>
                        <div style={{ fontSize: 11, opacity: 0.85 }}>{s.author}</div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }} className="ellipsis">{s.title}</div>
                        <div className="muted small">{t("library.episodeCount", { count: s.episode_count })}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <>
                  <div className="section-title">{t("library.recent")}</div>
                  <div className="group">{recent.map((e) => <EpisodeRow key={e.id} ep={e} />)}</div>
                </>
              )}
              {standalone.length > 0 && (
                <>
                  <div className="section-title">{t("library.standalone")}</div>
                  <div className="group">{standalone.map((e) => <EpisodeRow key={e.id} ep={e} />)}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {newShow && <NewShowSheet onClose={() => setNewShow(false)} />}
      {newEp && <NewEpisodeSheet onClose={() => setNewEp(false)} />}
    </>
  );
}

export function ShowView({ id }: { id: string }) {
  const { t } = useTranslation();
  const { shows, episodes, go, fail } = useStore();
  const show = shows.find((s) => s.id === id);
  const [edit, setEdit] = useState(false);
  const [newEp, setNewEp] = useState(false);
  if (!show) return null;
  const eps = episodes.filter((e) => e.show_id === id);
  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <button className="btn plain sm" onClick={() => go({ name: "library" })}>{t("library.showView.back")}</button>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => setEdit(true)}>{t("common.edit")}</button>
        <button
          className="btn icon danger"
          title={t("library.showView.deleteTitle")}
          onClick={async () => {
            if (!confirm(t("library.showView.deleteConfirm", { title: show.title }))) return;
            try {
              await del(`/shows/${id}`);
              go({ name: "library" });
            } catch (e) {
              fail(e);
            }
          }}
        >
          <Trash2 size={14} />
        </button>
        <button className="btn primary" onClick={() => setNewEp(true)}><FilePlus2 size={15} />{t("library.newEpisode")}</button>
      </div>
      <div className="content">
        <div className="page">
          <div className="ep-head">
            <div className="cover" style={{ ...coverStyle(show.color), width: 170 }}>
              <div className="t" style={{ fontSize: 22 }}>{show.title}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="muted small" style={{ fontWeight: 600 }}>{t("library.showView.kind")}</div>
              <div className="ep-title" style={{ fontSize: 30 }}>{show.title}</div>
              <div className="muted">{show.author}</div>
              <p className="muted" style={{ maxWidth: 620 }}>{show.description}</p>
            </div>
          </div>
          {eps.length ? (
            <div className="group">{eps.map((e) => <EpisodeRow key={e.id} ep={e} />)}</div>
          ) : (
            <Empty icon={<FilePlus2 size={28} />} title={t("library.showView.noEpisodes")} action={<button className="btn primary" onClick={() => setNewEp(true)}>{t("library.newEpisode")}</button>} />
          )}
        </div>
      </div>
      {edit && <NewShowSheet show={show} onClose={() => setEdit(false)} />}
      {newEp && <NewEpisodeSheet showId={id} onClose={() => setNewEp(false)} />}
    </>
  );
}
