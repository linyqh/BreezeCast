import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, Lock, MoreHorizontal, Play, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, Unlock, Wand2 } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { del, get, isZh, patch, post, type Episode, type Line, type Params, type Voice } from "../api";
import { usePlayer, useStore } from "../store";
import { Avatar, Duration, EventChips, ParamsPanel, PlayButton, Sheet, Spinner, coverStyle } from "../ui";
import { StatusBadge } from "./Library";

const DIRECTION_PRESETS_ZH = ["热情开场", "轻松闲聊", "惊讶", "若有所思，语速放慢", "压低声音，像在说秘密", "激动，语速加快", "严肃认真", "温柔安慰", "忍不住笑"];
const DIRECTION_PRESETS_EN = ["Warm, welcoming opener", "Casual and relaxed", "Surprised", "Thoughtful, slower pace", "Whispering, secretive", "Excited, faster pace", "Serious and measured", "Gentle and reassuring"];

function toScript(ep: Episode): string {
  return ep.lines
    .map((l) => {
      const head = l.direction ? `${l.speaker} {${l.direction}}` : l.speaker;
      const pause = l.pause_ms !== 400 ? `\n<pause ${l.pause_ms}ms>` : "";
      return `${head}: ${l.text}${pause}`;
    })
    .join("\n");
}

export function EpisodeView({ id }: { id: string }) {
  const { go, fail, toast, voices, shows, episodeVersion, jobs } = useStore();
  const player = usePlayer();
  const [ep, setEp] = useState<Episode | null>(null);
  const [mode, setMode] = useState<"lines" | "script">("lines");
  const [busyLines, setBusyLines] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    get<Episode>(`/episodes/${id}`).then(setEp, fail);
  }, [id, episodeVersion[id], fail]);

  const job = jobs.find((j) => j.target_id === id && (j.status === "running" || j.status === "queued")) ?? null;
  const renderingLine = job?.result && typeof job.result.line_id === "string" ? job.result.line_id : null;
  const speakers = useMemo(() => [...new Set(ep?.lines.map((l) => l.speaker) ?? [])], [ep]);
  const show = shows.find((s) => s.id === ep?.show_id);
  if (!ep) return <div className="content"><div className="empty"><Spinner /></div></div>;

  const update = async (body: Partial<Record<string, unknown>>) => {
    try {
      setEp(await patch<Episode>(`/episodes/${id}`, body));
    } catch (e) {
      fail(e);
    }
  };
  const patchLine = async (lineId: string, body: Record<string, unknown>) => {
    try {
      setEp(await patch<Episode>(`/episodes/${id}/lines/${lineId}`, body));
    } catch (e) {
      fail(e);
    }
  };
  const setCast = (speaker: string, voiceId: string | null) => {
    const cast = ep.cast.filter((c) => c.speaker !== speaker);
    if (voiceId) cast.push({ speaker, voice_id: voiceId });
    void update({ cast });
  };
  const renderAll = async (force = false) => {
    try {
      await post(`/episodes/${id}/render`, { force });
      toast(force ? "已开始全部重新生成" : "已加入生成队列");
    } catch (e) {
      fail(e);
    }
  };
  const retake = async (line: Line, params?: Params) => {
    setBusyLines((s) => new Set(s).add(line.id));
    try {
      const next = await post<Episode>(`/episodes/${id}/lines/${line.id}/render`, { params: params ?? {} });
      setEp(next);
      const l = next.lines.find((x) => x.id === line.id);
      if (l?.audio) player.play({ key: `line-${l.id}-${l.audio.path}`, url: l.audio.url, title: `${l.speaker}`, subtitle: l.text, color: voiceOf(l.speaker)?.color });
    } catch (e) {
      fail(e);
    } finally {
      setBusyLines((s) => {
        const n = new Set(s);
        n.delete(line.id);
        return n;
      });
    }
  };
  const voiceOf = (speaker: string): Voice | undefined => {
    const c = ep.cast.find((c) => c.speaker === speaker);
    return voices.find((v) => v.id === c?.voice_id);
  };
  const doExport = async (format: "m4a" | "wav") => {
    setExporting(true);
    try {
      const r = await post<{ audio_path: string }>(`/episodes/${id}/export`, { format });
      toast(`已导出到 ${r.audio_path}`);
      await revealItemInDir(r.audio_path);
    } catch (e) {
      fail(e);
    } finally {
      setExporting(false);
    }
  };
  const playEpisode = () =>
    ep.audio && player.play({ key: `ep-${ep.id}-${ep.audio.rendered_at}`, url: ep.audio.url, title: ep.title, subtitle: show?.title, color: show?.color, chapters: ep.audio.chapters });
  const playingEpisode = player.track?.key === `ep-${ep.id}-${ep.audio?.rendered_at}`;
  const nowLine = playingEpisode ? ep.audio?.chapters?.find((c) => player.time * 1000 >= c.start_ms && player.time * 1000 < c.end_ms + 300)?.line_id : undefined;
  const missingCast = speakers.filter((s) => !voiceOf(s));
  const staleCount = ep.lines.filter((l) => l.stale).length;
  const totalMs = ep.lines.reduce((n, l) => n + (l.audio?.duration_ms ?? 0) + l.pause_ms, 0);

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <button className="btn plain sm" onClick={() => go(show ? { name: "show", id: show.id } : { name: "library" })}>‹ {show?.title ?? "节目"}</button>
        <StatusBadge status={job ? "rendering" : ep.status} />
        <div className="spacer" data-tauri-drag-region />
        <div className="seg">
          <button className={mode === "lines" ? "on" : ""} onClick={() => setMode("lines")}>逐句</button>
          <button className={mode === "script" ? "on" : ""} onClick={() => setMode("script")}>脚本</button>
        </div>
        <button className="btn icon" title="单集生成参数" onClick={() => setSettings(true)}><Settings2 size={15} /></button>
        <button className="btn" disabled={!ep.audio || exporting} onClick={() => doExport("m4a")} title="导出 M4A + SRT 字幕 + 章节">
          {exporting ? <Spinner /> : <Download size={15} />}导出
        </button>
        {ep.audio && ep.status === "rendered" ? (
          <button className="btn primary" onClick={playEpisode}><Play size={14} fill="currentColor" />播放</button>
        ) : (
          <button className="btn primary" disabled={!!job || missingCast.length > 0 || ep.lines.length === 0} onClick={() => renderAll()}>
            {job ? <Spinner /> : <Sparkles size={15} />}
            {job ? "生成中" : staleCount ? `生成 ${staleCount} 句并混音` : "混音"}
          </button>
        )}
      </div>
      <div className="content">
        <div className="page" style={{ maxWidth: 900 }}>
          <div className="ep-head">
            <div className="cover" style={coverStyle(show?.color ?? "#8E8E93")}>
              <div className="t" style={{ fontSize: 15 }}>{show?.title ?? "独立单集"}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input className="ep-title" defaultValue={ep.title} key={ep.title} onBlur={(e) => e.target.value !== ep.title && update({ title: e.target.value })} />
              <input
                className="input"
                style={{ background: "none", boxShadow: "none", padding: 0, height: 22, color: "var(--fg-2)" }}
                placeholder="添加简介…"
                defaultValue={ep.description}
                key={`d-${ep.description}`}
                onBlur={(e) => e.target.value !== ep.description && update({ description: e.target.value })}
              />
              <div className="hstack muted small" style={{ marginTop: 8 }}>
                <span>{ep.lines.length} 句</span>·<span>{ep.audio ? <Duration ms={ep.audio.duration_ms} /> : totalMs ? `约 ${Math.round(totalMs / 1000)} 秒` : "未生成"}</span>
                {staleCount > 0 && <span className="badge orange">{staleCount} 句待生成</span>}
                {ep.audio && (
                  <>
                    · <button className="btn sm plain" onClick={() => doExport("wav")}>导出 WAV</button>
                    <button className="btn sm plain" onClick={() => renderAll(true)} disabled={!!job}>全部重录</button>
                  </>
                )}
              </div>
            </div>
          </div>

          {job && (
            <div className="card pad" style={{ marginBottom: 14 }}>
              <div className="hstack" style={{ marginBottom: 8 }}>
                <Spinner />
                <span style={{ flex: 1 }}>{job.message}</span>
                <span className="muted small">{Math.round(job.progress * 100)}%</span>
                <button className="btn sm" onClick={() => post(`/jobs/${job.id}/cancel`).catch(fail)}><Square size={11} fill="currentColor" />停止</button>
              </div>
              <div className="progress"><div style={{ width: `${job.progress * 100}%` }} /></div>
            </div>
          )}
          {ep.failed && !job && <div className="card pad err" style={{ marginBottom: 14 }}>上次生成失败：{ep.failed}</div>}

          <div className="label" style={{ marginBottom: 8 }}>角色与声音</div>
          <div className="cast" style={{ marginBottom: 22 }}>
            {speakers.map((s) => {
              const v = voiceOf(s);
              return (
                <div key={s} className="cast-item" style={!v ? { boxShadow: "0 0 0 1px var(--orange)" } : undefined}>
                  <Avatar voice={v} name={s} size="sm" />
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{s}</span>
                  <select value={v?.id ?? ""} onChange={(e) => setCast(s, e.target.value || null)}>
                    <option value="">选择声音…</option>
                    {voices.map((vv) => <option key={vv.id} value={vv.id}>{vv.name}</option>)}
                  </select>
                </div>
              );
            })}
            {voices.length === 0 && (
              <button className="btn sm" onClick={() => go({ name: "design" })}><Wand2 size={13} />先去设计一个声音</button>
            )}
          </div>

          {mode === "script" ? (
            <ScriptEditor ep={ep} onApply={(script) => update({ script })} />
          ) : (
            <div className="lines">
              {ep.lines.map((l, i) => (
                <LineCard
                  key={l.id}
                  ep={ep}
                  line={l}
                  index={i}
                  speakers={speakers}
                  voice={voiceOf(l.speaker)}
                  busy={busyLines.has(l.id) || renderingLine === l.id}
                  playing={nowLine === l.id}
                  onPatch={(b) => patchLine(l.id, b)}
                  onRetake={(p) => retake(l, p)}
                  onDelete={async () => setEp(await del<Episode>(`/episodes/${id}/lines/${l.id}`))}
                  onInsert={async () => setEp(await post<Episode>(`/episodes/${id}/lines`, { after_line_id: l.id, speaker: speakers.find((s) => s !== l.speaker) ?? l.speaker, text: "" }))}
                />
              ))}
              <button
                className="btn"
                style={{ alignSelf: "flex-start", marginTop: 6 }}
                onClick={async () => setEp(await post<Episode>(`/episodes/${id}/lines`, { speaker: speakers[ep.lines.length % Math.max(1, speakers.length)] ?? "主持人", text: "" }))}
              >
                <Plus size={14} />添加一句
              </button>
            </div>
          )}
        </div>
      </div>
      {settings && (
        <Sheet title="单集生成参数" subtitle="对本集所有台词生效；声音和单句上的设置优先级更高。" onClose={() => setSettings(false)} width={680} actions={<button className="btn primary" onClick={() => setSettings(false)}>完成</button>}>
          <ParamsPanel value={ep.params} onChange={(params) => void update({ params })} defaultOpen />
        </Sheet>
      )}
    </>
  );
}

function ScriptEditor({ ep, onApply }: { ep: Episode; onApply: (s: string) => void }) {
  const original = useMemo(() => toScript(ep), [ep]);
  const [text, setText] = useState(original);
  useEffect(() => setText(original), [original]);
  return (
    <div className="vstack">
      <textarea className="textarea mono" style={{ minHeight: 420, fontSize: 13, lineHeight: 1.7 }} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="hstack">
        <span className="hint" style={{ flex: 1 }}>未改动的句子会保留已生成的音频。<span className="kbd">{"角色 {指导}: 台词"}</span> <span className="kbd">{"<pause 1s>"}</span></span>
        <button className="btn" disabled={text === original} onClick={() => setText(original)}>还原</button>
        <button className="btn primary" disabled={text === original} onClick={() => onApply(text)}>应用脚本</button>
      </div>
    </div>
  );
}

type LineProps = {
  ep: Episode;
  line: Line;
  index: number;
  speakers: string[];
  voice?: Voice;
  busy: boolean;
  playing: boolean;
  onPatch: (b: Record<string, unknown>) => Promise<void>;
  onRetake: (p?: Params) => Promise<void>;
  onDelete: () => Promise<void>;
  onInsert: () => Promise<void>;
};

function LineCard({ ep, line, index, speakers, voice, busy, playing, onPatch, onRetake, onDelete, onInsert }: LineProps) {
  const [text, setText] = useState(line.text);
  const [direction, setDirection] = useState(line.direction);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused) {
      setText(line.text);
      setDirection(line.direction);
    }
  }, [line.text, line.direction, focused]);
  const zh = isZh(text || ep.title);
  const seedLocked = line.params?.seed !== undefined;
  const commit = () => {
    const b: Record<string, unknown> = {};
    if (text.trim() !== line.text) b.text = text;
    if (direction.trim() !== line.direction) b.direction = direction;
    if (Object.keys(b).length) void onPatch(b);
  };
  const status = busy ? "busy" : line.stale ? "stale" : "done";
  return (
    <>
      <div
        className={`line ${playing ? "playing" : ""}`}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
            commit();
          }
        }}
      >
        <div className={`status ${status}`} title={status === "stale" ? "需要生成" : status === "busy" ? "生成中" : "已生成"} />
        <Avatar voice={voice} name={line.speaker} />
        <div style={{ minWidth: 0 }}>
          <div className="who">
            <select
              value={line.speaker}
              onChange={(e) => {
                const v = e.target.value === "__new" ? prompt("新角色名称")?.trim() : e.target.value;
                if (v) void onPatch({ speaker: v });
              }}
              style={{ border: 0, background: "none", font: "inherit", fontWeight: 650, color: voice?.color ?? "var(--fg)", outline: "none", padding: 0 }}
            >
              {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value="__new">＋ 新角色…</option>
            </select>
            <span className="muted" style={{ fontWeight: 400 }}>#{index + 1}</span>
            {line.audio && <Duration ms={line.audio.duration_ms} />}
            {seedLocked && <span className="badge" title="已锁定这一条（固定种子）"><Lock size={9} />&nbsp;锁定</span>}
          </div>
          <textarea ref={ta} value={text} rows={1} placeholder="输入台词…" onChange={(e) => setText(e.target.value)} />
          <input className="dir" value={direction} placeholder={voice?.has_reference ? "＋ 演绎指导（语气、情绪、语速）" : "＋ 演绎指导（会叠加在声音描述之后）"} onChange={(e) => setDirection(e.target.value)} />
          {focused && (
            <div className="vstack" style={{ gap: 8, marginTop: 10 }}>
              <div className="hstack" style={{ flexWrap: "wrap" }}>
                <span className="hint">声音事件</span>
                <EventChips target={ta} value={text} onChange={setText} lang={zh ? "zh" : "en"} />
              </div>
              <div className="hstack" style={{ flexWrap: "wrap" }}>
                <span className="hint">指导</span>
                <div className="chips">
                  {(zh ? DIRECTION_PRESETS_ZH : DIRECTION_PRESETS_EN).map((d) => (
                    <button key={d} className={`chip ${direction === d ? "on" : ""}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setDirection(direction === d ? "" : d)}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="tools">
          {line.audio && !line.stale && (
            <PlayButton track={{ key: `line-${line.id}-${line.audio.path}`, url: line.audio.url, title: line.speaker, subtitle: line.text, color: voice?.color }} />
          )}
          <button className="btn icon plain" title={line.audio ? "换一条（新的随机演绎）" : "生成这一句"} disabled={busy || !voice || !text.trim()} onClick={() => { commit(); void onRetake(seedLocked ? { seed: line.params?.seed } : undefined); }}>
            {busy ? <Spinner /> : <RefreshCw size={14} />}
          </button>
          <div style={{ position: "relative" }}>
            <button className="btn icon plain" onClick={() => setMenu(!menu)} onBlur={() => setTimeout(() => setMenu(false), 150)}><MoreHorizontal size={15} /></button>
            {menu && (
              <div className="card" style={{ position: "absolute", right: 0, top: 32, zIndex: 10, padding: 5, width: 190, boxShadow: "var(--shadow-float)" }}>
                {line.audio && (
                  <MenuItem icon={seedLocked ? <Unlock size={13} /> : <Lock size={13} />} onClick={() => onPatch({ params: seedLocked ? { ...line.params, seed: undefined } : { ...(line.params ?? {}), seed: line.audio?.seed } })}>
                    {seedLocked ? "解锁这一条" : "锁定当前这一条"}
                  </MenuItem>
                )}
                <MenuItem icon={<Plus size={13} />} onClick={onInsert}>在下方插入一句</MenuItem>
                <MenuItem icon={<ArrowUp size={13} />} onClick={() => onPatch({ move_to: Math.max(0, index - 1) })}>上移</MenuItem>
                <MenuItem icon={<ArrowDown size={13} />} onClick={() => onPatch({ move_to: index + 1 })}>下移</MenuItem>
                <MenuItem icon={<FileText size={13} />} onClick={() => navigator.clipboard.writeText(`${line.speaker}: ${line.text}`)}>复制台词</MenuItem>
                <MenuItem icon={<Trash2 size={13} />} danger onClick={onDelete}>删除</MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>
      {index < ep.lines.length - 1 && (
        <div className="pause-pill">
          停顿
          <input defaultValue={(line.pause_ms / 1000).toFixed(1)} key={line.pause_ms} onBlur={(e) => {
            const s = Number(e.target.value);
            if (Number.isFinite(s) && Math.round(s * 1000) !== line.pause_ms) void onPatch({ pause_ms: Math.max(0, Math.round(s * 1000)) });
          }} />
          秒
        </div>
      )}
    </>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => unknown; danger?: boolean }) {
  return (
    <button className={`side-item ${danger ? "danger" : ""}`} style={{ height: 28, fontSize: 12.5, color: danger ? "var(--red)" : undefined }} onMouseDown={(e) => e.preventDefault()} onClick={() => void onClick()}>
      {icon}
      {children}
    </button>
  );
}
