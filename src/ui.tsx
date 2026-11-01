import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, Dices, Lock, Pause, Play, Unlock } from "lucide-react";
import { VOCAL_EVENTS, fmtMs, mediaUrl, type Params, type Voice } from "./api";
import { peaksOf } from "./audio";
import { usePlayer, type Track } from "./store";

export function Spinner() {
  return <span className="spin" />;
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, subtitle, children, onClose, actions, width }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; actions?: ReactNode; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={width ? { width } : undefined}>
        <h2>{title}</h2>
        {subtitle && <div className="muted small" style={{ marginBottom: 16 }}>{subtitle}</div>}
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Avatar({ voice, name, size = "" }: { voice?: Voice | null; name?: string; size?: "" | "sm" | "lg" }) {
  const label = (voice?.name ?? name ?? "?").trim().slice(0, 1).toUpperCase();
  const color = voice?.color ?? "#8e8e93";
  return (
    <div className={`avatar ${size}`} style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${color} 70%, #fff), ${color})` }}>
      {label}
    </div>
  );
}

export function coverStyle(color: string) {
  return { background: `linear-gradient(145deg, color-mix(in srgb, ${color} 75%, #fff) 0%, ${color} 45%, color-mix(in srgb, ${color} 55%, #000) 100%)` };
}

export function PlayButton({ track, size = "sm" }: { track: Track; size?: "sm" | "md" }) {
  const p = usePlayer();
  const active = p.track?.key === track.key;
  const on = active && p.playing;
  return (
    <button
      className={`btn icon ${size === "sm" ? "plain" : ""}`}
      title={on ? "暂停" : "播放"}
      onClick={(e) => {
        e.stopPropagation();
        if (active) p.toggle();
        else p.play(track);
      }}
    >
      {on ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
    </button>
  );
}

export function Waveform({ url, color, version }: { url: string; color?: string; version?: string | number }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let alive = true;
    peaksOf(mediaUrl(url, version), 90).then((p) => alive && setPeaks(p)).catch(() => alive && setPeaks([]));
    return () => {
      alive = false;
    };
  }, [url, version]);
  return (
    <div className="wave" style={{ color: color ?? "var(--accent)" }}>
      {(peaks ?? Array(90).fill(0.05)).map((p, i) => (
        <span key={i} style={{ height: `${Math.max(4, p * 100)}%`, opacity: peaks ? 0.85 : 0.2 }} />
      ))}
    </div>
  );
}

/** Inserts a vocal-event tag at the caret of the referenced textarea. */
export function EventChips({ target, value, onChange, lang }: { target: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; lang: "zh" | "en" }) {
  const insert = (tag: string) => {
    const el = target.current;
    const pos = el ? el.selectionStart : value.length;
    const before = value.slice(0, pos);
    const needSpace = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${needSpace}${tag} ${value.slice(el ? el.selectionEnd : value.length)}`;
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const c = pos + needSpace.length + tag.length + 1;
      el.setSelectionRange(c, c);
    });
  };
  return (
    <div className="chips">
      {VOCAL_EVENTS[lang].map((e) => (
        <button key={e.tag} className="chip" onClick={() => insert(e.tag)} title={`插入 ${e.tag}`}>
          {e.tag}
        </button>
      ))}
    </div>
  );
}

export function VoiceSelect({ voices, value, onChange, allowNone, noneLabel = "不使用声音（仅描述）" }: { voices: Voice[]; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {!allowNone && !value && <option value="">选择声音…</option>}
      {voices.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
          {v.has_reference ? "" : "（描述型）"}
        </option>
      ))}
    </select>
  );
}

function Slider({ label, hint, value, min, max, step, onChange, placeholder }: { label: string; hint?: string; value: number | undefined; min: number; max: number; step: number; onChange: (v: number | undefined) => void; placeholder: string }) {
  return (
    <div className="field">
      <label title={hint}>{label}</label>
      <div className="slider">
        <input type="range" min={min} max={max} step={step} value={value ?? (Number.isFinite(Number(placeholder)) ? Number(placeholder) : min)} onChange={(e) => onChange(Number(e.target.value))} style={{ opacity: value === undefined ? 0.45 : 1 }} />
        <input
          className="input num"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Every BreezeTTS 2 request option. Unset fields fall back to the model defaults. */
export function ParamsPanel({ value, onChange, defaultOpen = false, autoGuidance = true }: { value: Params; onChange: (p: Params) => void; defaultOpen?: boolean; autoGuidance?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const set = <K extends keyof Params>(k: K, v: Params[K]) => {
    const next = { ...value };
    if (v === undefined || (typeof v === "number" && Number.isNaN(v))) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const seedLocked = value.seed !== undefined;
  const changed = Object.keys(value).length;
  return (
    <div className="card" style={{ padding: open ? 16 : 0 }}>
      <button className="btn plain" style={{ width: "100%", justifyContent: "space-between", height: open ? 26 : 42, padding: open ? 0 : "0 16px", borderRadius: 14 }} onClick={() => setOpen(!open)}>
        <span className="hstack">
          生成参数 {changed > 0 && <span className="badge accent">{changed} 项自定义</span>}
        </span>
        <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="grid cols-2" style={{ marginTop: 14, gap: 16 }}>
          <Slider label="指令强度 guidance_scale" hint={autoGuidance ? "留空为自动：有描述/指导时 4，否则 1。越高越贴合描述，生成约慢一倍" : "越高越贴合描述"} value={value.guidance_scale} min={0} max={8} step={0.5} placeholder="auto" onChange={(v) => set("guidance_scale", v)} />
          <Slider label="表现力 temperature" hint="低：稳定克制；高：起伏更大（默认 0.9）" value={value.temperature} min={0.1} max={1.5} step={0.05} placeholder="0.9" onChange={(v) => set("temperature", v)} />
          <Slider label="声学细节 depth_temperature" hint="深度解码器采样温度（默认 0.9）" value={value.depth_temperature} min={0.1} max={1.5} step={0.05} placeholder="0.9" onChange={(v) => set("depth_temperature", v)} />
          <Slider label="top_p" hint="核采样阈值，1 = 关闭" value={value.top_p} min={0.05} max={1} step={0.05} placeholder="1" onChange={(v) => set("top_p", v)} />
          <Slider label="top_k" hint="候选数上限，0 = 关闭（默认 50）" value={value.top_k} min={0} max={200} step={1} placeholder="50" onChange={(v) => set("top_k", v)} />
          <Slider label="最长帧数 max_tokens" hint="每段最长声学帧（12.5 帧 ≈ 1 秒，默认 1500）" value={value.max_tokens} min={100} max={3000} step={50} placeholder="1500" onChange={(v) => set("max_tokens", v)} />
          <div className="field">
            <label>随机种子 seed</label>
            <div className="hstack">
              <input className="input num" style={{ flex: 1, textAlign: "left" }} placeholder="每次随机" value={value.seed ?? ""} onChange={(e) => set("seed", e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))))} />
              <button className="btn icon" title="随机一个种子" onClick={() => set("seed", Math.floor(Math.random() * 2 ** 31))}>
                <Dices size={15} />
              </button>
              <button className="btn icon" title={seedLocked ? "解锁（每次随机）" : "已解锁"} onClick={() => set("seed", undefined)} disabled={!seedLocked}>
                {seedLocked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </div>
            <div className="hint">固定种子 + 相同输入 = 完全相同的一条</div>
          </div>
          <div className="field">
            <label>长文本切分</label>
            <div className="hstack">
              <input className="input num" style={{ width: 80 }} placeholder="600" value={value.text_chunk_size ?? ""} onChange={(e) => set("text_chunk_size", e.target.value === "" ? undefined : Number(e.target.value))} />
              <select className="input" value={value.text_chunk_mode ?? ""} onChange={(e) => set("text_chunk_mode", e.target.value || undefined)}>
                <option value="">默认</option>
                <option value="tag_aware">保留标签 tag_aware</option>
                <option value="endline">按换行 endline</option>
              </select>
            </div>
            <div className="hint">每段最多字符数与切分方式</div>
          </div>
          {changed > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <button className="btn sm" onClick={() => onChange({})}>全部恢复默认</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Duration({ ms }: { ms: number }) {
  return <span className="muted small" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMs(ms)}</span>;
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
