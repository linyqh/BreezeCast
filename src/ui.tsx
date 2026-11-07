import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, Dices, Languages, Lock, Pause, Play, Unlock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { VOCAL_EVENTS, fmtMs, mediaUrl, type Params, type Voice } from "./api";
import { LANGUAGES, type LanguageCode } from "./i18n/languages";
import { currentLanguage, setLanguage } from "./i18n";
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
  const { t } = useTranslation();
  const p = usePlayer();
  const active = p.track?.key === track.key;
  const on = active && p.playing;
  return (
    <button
      className={`btn icon ${size === "sm" ? "plain" : ""}`}
      title={on ? t("common.pause") : t("common.play")}
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
  const { t } = useTranslation();
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
        <button key={e.tag} className="chip" onClick={() => insert(e.tag)} title={t("ui.insertTag", { tag: e.tag })}>
          {e.tag}
        </button>
      ))}
    </div>
  );
}

export function VoiceSelect({ voices, value, onChange, allowNone, noneLabel }: { voices: Voice[]; value: string | null; onChange: (id: string | null) => void; allowNone?: boolean; noneLabel?: string }) {
  const { t } = useTranslation();
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel ?? t("ui.noVoice")}</option>}
      {!allowNone && !value && <option value="">{t("ui.chooseVoice")}</option>}
      {voices.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
          {v.has_reference ? "" : t("ui.descriptionVoice")}
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
  const { t } = useTranslation();
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
          {t("ui.params.title")} {changed > 0 && <span className="badge accent">{t("ui.params.customized", { count: changed })}</span>}
        </span>
        <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      {open && (
        <div className="grid cols-2" style={{ marginTop: 14, gap: 16 }}>
          <Slider label={t("ui.params.guidance.label")} hint={autoGuidance ? t("ui.params.guidance.hintAuto") : t("ui.params.guidance.hint")} value={value.guidance_scale} min={0} max={8} step={0.5} placeholder="auto" onChange={(v) => set("guidance_scale", v)} />
          <Slider label={t("ui.params.temperature.label")} hint={t("ui.params.temperature.hint")} value={value.temperature} min={0.1} max={1.5} step={0.05} placeholder="0.9" onChange={(v) => set("temperature", v)} />
          <Slider label={t("ui.params.depthTemperature.label")} hint={t("ui.params.depthTemperature.hint")} value={value.depth_temperature} min={0.1} max={1.5} step={0.05} placeholder="0.9" onChange={(v) => set("depth_temperature", v)} />
          <Slider label="top_p" hint={t("ui.params.topP.hint")} value={value.top_p} min={0.05} max={1} step={0.05} placeholder="1" onChange={(v) => set("top_p", v)} />
          <Slider label="top_k" hint={t("ui.params.topK.hint")} value={value.top_k} min={0} max={200} step={1} placeholder="50" onChange={(v) => set("top_k", v)} />
          <Slider label={t("ui.params.maxTokens.label")} hint={t("ui.params.maxTokens.hint")} value={value.max_tokens} min={100} max={3000} step={50} placeholder="1500" onChange={(v) => set("max_tokens", v)} />
          <div className="field">
            <label>{t("ui.params.seed.label")}</label>
            <div className="hstack">
              <input className="input num" style={{ flex: 1, textAlign: "left" }} placeholder={t("ui.params.seed.placeholder")} value={value.seed ?? ""} onChange={(e) => set("seed", e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))))} />
              <button className="btn icon" title={t("ui.params.seed.roll")} onClick={() => set("seed", Math.floor(Math.random() * 2 ** 31))}>
                <Dices size={15} />
              </button>
              <button className="btn icon" title={seedLocked ? t("ui.params.seed.unlock") : t("ui.params.seed.unlocked")} onClick={() => set("seed", undefined)} disabled={!seedLocked}>
                {seedLocked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
            </div>
            <div className="hint">{t("ui.params.seed.hint")}</div>
          </div>
          <div className="field">
            <label>{t("ui.params.chunk.label")}</label>
            <div className="hstack">
              <input className="input num" style={{ width: 80 }} placeholder="600" value={value.text_chunk_size ?? ""} onChange={(e) => set("text_chunk_size", e.target.value === "" ? undefined : Number(e.target.value))} />
              <select className="input" value={value.text_chunk_mode ?? ""} onChange={(e) => set("text_chunk_mode", e.target.value || undefined)}>
                <option value="">{t("ui.params.chunk.default")}</option>
                <option value="tag_aware">{t("ui.params.chunk.tagAware")}</option>
                <option value="endline">{t("ui.params.chunk.endline")}</option>
              </select>
            </div>
            <div className="hint">{t("ui.params.chunk.hint")}</div>
          </div>
          {changed > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <button className="btn sm" onClick={() => onChange({})}>{t("ui.params.resetAll")}</button>
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

/** Lists every registered UI language; the choice is persisted by `setLanguage`. */
export function LanguageSwitcher() {
  const { t } = useTranslation(); // re-renders on language change
  const active = currentLanguage();
  return (
    <label className="lang-switch" title={t("app.languageSwitcher.label")}>
      <Languages size={14} />
      <select aria-label={t("app.languageSwitcher.label")} value={active} onChange={(e) => void setLanguage(e.target.value as LanguageCode)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
