import { useState } from "react";
import { FilePlus2, Library, Plus, Radio, Trash2 } from "lucide-react";
import { del, patch, post, type Episode, type Show } from "../api";
import { useStore } from "../store";
import { Duration, Empty, PlayButton, Sheet, coverStyle } from "../ui";

const SHOW_COLORS = ["#5E5CE6", "#0A84FF", "#BF5AF2", "#FF375F", "#FF9F0A", "#30D158", "#64D2FF", "#AC8E68"];

const SCRIPT_TEMPLATE = `主持人: [笑] 大家好，欢迎收听本期节目！
嘉宾 {轻松、带点好奇}: 你好你好，很高兴来到这里。
主持人: 今天我们聊一个有意思的话题……
<pause 1s>
嘉宾 {若有所思，语速放慢}: 嗯，我觉得这个问题可以从两方面看。`;

const STATUS_BADGE: Record<Episode["status"], [string, string]> = {
  draft: ["草稿", ""],
  rendering: ["生成中", "accent"],
  rendered: ["已完成", "green"],
  stale: ["有改动", "orange"],
  failed: ["失败", "red"],
};

export function StatusBadge({ status }: { status: Episode["status"] }) {
  const [label, cls] = STATUS_BADGE[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function NewShowSheet({ onClose, show }: { onClose: () => void; show?: Show }) {
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
      title={show ? "编辑节目" : "新建节目"}
      subtitle="节目是单集的合集，例如一档每周更新的对谈播客。"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!title.trim()} onClick={save}>{show ? "保存" : "创建"}</button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 18 }}>
        <div className="cover" style={coverStyle(color)}>
          <div className="t">{title || "节目名称"}</div>
        </div>
        <div className="vstack">
          <div className="field">
            <label>名称</label>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：声波漫谈" />
          </div>
          <div className="field">
            <label>主播 / 作者</label>
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
        <label>简介</label>
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 70 }} />
      </div>
    </Sheet>
  );
}

export function NewEpisodeSheet({ onClose, showId }: { onClose: () => void; showId?: string | null }) {
  const { go, fail, shows } = useStore();
  const [title, setTitle] = useState("");
  const [show, setShow] = useState<string>(showId ?? "");
  const [script, setScript] = useState(SCRIPT_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const ep = await post<Episode>("/episodes", { title: title || "未命名单集", show_id: show || null, script });
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
      title="新建单集"
      subtitle="粘贴或编写脚本，之后可以在编辑器里逐句调整、分配声音。"
      width={680}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={create}>创建单集</button>
        </>
      }
    >
      <div className="grid cols-2">
        <div className="field">
          <label>标题</label>
          <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="第 1 期：…" />
        </div>
        <div className="field">
          <label>所属节目</label>
          <select className="input" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="">独立单集</option>
            {shows.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>脚本</label>
        <textarea className="textarea mono" style={{ minHeight: 220, fontSize: 13 }} value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="hint">
          <span className="kbd">角色: 台词</span> 一行一句 · <span className="kbd">{"角色 {演绎指导}: 台词"}</span> 控制语气 · <span className="kbd">{"<pause 1.5s>"}</span> 插入停顿 · 中文用 <span className="kbd">[笑]</span> 英文用 <span className="kbd">(laugh)</span> 插入声音事件。与声音库同名的角色会自动配音。
        </div>
      </div>
    </Sheet>
  );
}

function EpisodeRow({ ep }: { ep: Episode }) {
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
          {ep.line_count ?? 0} 句 · {ep.cast.length} 位角色 {show ? `· ${show.title}` : ""}
        </div>
      </div>
      <StatusBadge status={ep.status} />
      {ep.audio && <Duration ms={ep.audio.duration_ms} />}
      <button
        className="btn icon plain"
        title="删除单集"
        onClick={async (e) => {
          e.stopPropagation();
          if (!confirm(`删除单集“${ep.title}”？已生成的音频也会删除。`)) return;
          await del(`/episodes/${ep.id}`).catch(fail);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function LibraryView() {
  const { shows, episodes, go } = useStore();
  const [newShow, setNewShow] = useState(false);
  const [newEp, setNewEp] = useState(false);
  const standalone = episodes.filter((e) => !e.show_id);
  const recent = [...episodes].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>节目</h1>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => setNewShow(true)}><Plus size={15} />新建节目</button>
        <button className="btn primary" onClick={() => setNewEp(true)}><FilePlus2 size={15} />新建单集</button>
      </div>
      <div className="content">
        <div className="page">
          {shows.length === 0 && episodes.length === 0 ? (
            <Empty
              icon={<Library size={30} />}
              title="开始你的第一档播客"
              action={<div className="hstack" style={{ justifyContent: "center" }}><button className="btn" onClick={() => setNewShow(true)}>新建节目</button><button className="btn primary" onClick={() => setNewEp(true)}>写一集脚本</button></div>}
            >
              先在“声音设计”或“声音克隆”中准备主播声音，再用脚本创建单集。BreezeTTS 2 会逐句生成、自动混音并导出 M4A 与字幕。
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
                        <div className="muted small">{s.episode_count} 集</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <>
                  <div className="section-title">最近编辑</div>
                  <div className="group">{recent.map((e) => <EpisodeRow key={e.id} ep={e} />)}</div>
                </>
              )}
              {standalone.length > 0 && (
                <>
                  <div className="section-title">独立单集</div>
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
  const { shows, episodes, go, fail } = useStore();
  const show = shows.find((s) => s.id === id);
  const [edit, setEdit] = useState(false);
  const [newEp, setNewEp] = useState(false);
  if (!show) return null;
  const eps = episodes.filter((e) => e.show_id === id);
  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <button className="btn plain sm" onClick={() => go({ name: "library" })}>‹ 节目</button>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => setEdit(true)}>编辑</button>
        <button
          className="btn icon danger"
          title="删除节目（单集会保留为独立单集）"
          onClick={async () => {
            if (!confirm(`删除节目“${show.title}”？其中的单集会保留为独立单集。`)) return;
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
        <button className="btn primary" onClick={() => setNewEp(true)}><FilePlus2 size={15} />新建单集</button>
      </div>
      <div className="content">
        <div className="page">
          <div className="ep-head">
            <div className="cover" style={{ ...coverStyle(show.color), width: 170 }}>
              <div className="t" style={{ fontSize: 22 }}>{show.title}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="muted small" style={{ fontWeight: 600 }}>播客节目</div>
              <div className="ep-title" style={{ fontSize: 30 }}>{show.title}</div>
              <div className="muted">{show.author}</div>
              <p className="muted" style={{ maxWidth: 620 }}>{show.description}</p>
            </div>
          </div>
          {eps.length ? (
            <div className="group">{eps.map((e) => <EpisodeRow key={e.id} ep={e} />)}</div>
          ) : (
            <Empty icon={<FilePlus2 size={28} />} title="还没有单集" action={<button className="btn primary" onClick={() => setNewEp(true)}>新建单集</button>} />
          )}
        </div>
      </div>
      {edit && <NewShowSheet show={show} onClose={() => setEdit(false)} />}
      {newEp && <NewEpisodeSheet showId={id} onClose={() => setNewEp(false)} />}
    </>
  );
}
