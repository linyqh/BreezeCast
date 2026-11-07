import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, Bot, Cpu, Library, Mic, Pause, Play, Sparkles, Users, Wand2, X } from "lucide-react";
import { backendLabel, initApi, fmtMs, localized } from "./api";
import { StoreProvider, usePlayer, useStore, type Route } from "./store";
import { LibraryView, ShowView } from "./views/Library";
import { EpisodeView } from "./views/Episode";
import { SpeakView } from "./views/Speak";
import { DesignView } from "./views/Design";
import { CloneView } from "./views/Clone";
import { VoicesView } from "./views/Voices";
import { EngineView } from "./views/Engine";
import { AgentsView } from "./views/Agents";
import { LanguageSwitcher, Spinner } from "./ui";

type NavKey = "library" | "create" | "system";
type NavLabel = "shows" | "speak" | "design" | "clone" | "voices" | "engine" | "agents";

const NAV: { section: NavKey; items: { route: Route["name"]; label: NavLabel; icon: typeof Library }[] }[] = [
  { section: "library", items: [{ route: "library", label: "shows", icon: Library }] },
  {
    section: "create",
    items: [
      { route: "speak", label: "speak", icon: AudioLines },
      { route: "design", label: "design", icon: Wand2 },
      { route: "clone", label: "clone", icon: Mic },
      { route: "voices", label: "voices", icon: Users },
    ],
  },
  {
    section: "system",
    items: [
      { route: "engine", label: "engine", icon: Cpu },
      { route: "agents", label: "agents", icon: Bot },
    ],
  },
];

function Sidebar() {
  const { t } = useTranslation();
  const { route, go, engine, voices, shows, status } = useStore();
  const active = route.name === "show" || route.name === "episode" ? "library" : route.name;
  const counts: Partial<Record<Route["name"], number>> = { library: shows.length, voices: voices.length };
  return (
    <aside className="sidebar">
      <div className="drag" data-tauri-drag-region />
      <div className="brand" data-tauri-drag-region>
        <div className="brand-name" data-tauri-drag-region>
          Breeze<b>Cast</b>
        </div>
        <div className="brand-tag" data-tauri-drag-region>{t("app.tagline")}</div>
      </div>
      {NAV.map((g) => (
        <div key={g.section}>
          <div className="side-section">{t(`app.nav.${g.section}`)}</div>
          {g.items.map((it) => (
            <button key={it.route} className={`side-item ${active === it.route ? "active" : ""}`} onClick={() => go({ name: it.route } as Route)}>
              <it.icon size={16} strokeWidth={1.9} />
              {t(`app.nav.${it.label}`)}
              {counts[it.route] ? <span className="count">{counts[it.route]}</span> : null}
            </button>
          ))}
        </div>
      ))}
      <div className="side-foot">
        <button className="engine-pill" onClick={() => go({ name: "engine" })}>
          <span className={`dot ${engine?.state ?? ""}`} />
          <span className="grow" style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{t(`app.enginePill.${engine?.state ?? "stopped"}`)}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              BreezeTTS 2 · {status?.model.active_package.replace("breeze_tts_2_", "").toUpperCase() ?? "—"} · {backendLabel(engine?.backend)}
            </div>
          </span>
        </button>
        <LanguageSwitcher />
      </div>
    </aside>
  );
}

function PlayerBar() {
  const { t: tr } = useTranslation();
  const p = usePlayer();
  const t = p.track;
  const dur = p.duration || 0;
  return (
    <div className={`player ${t ? "" : "hidden"}`}>
      <div className="art" style={{ background: `linear-gradient(150deg, color-mix(in srgb, ${t?.color ?? "#5E5CE6"} 70%, #fff), ${t?.color ?? "#5E5CE6"})` }}>
        <AudioLines size={20} />
      </div>
      <div className="meta">
        <div className="t ellipsis">{t?.title}</div>
        <div className="s ellipsis">{currentChapter(p.time, t?.chapters, (c) => tr("app.player.chapter", c)) ?? t?.subtitle}</div>
      </div>
      <button className="play-btn" onClick={p.toggle}>
        {p.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <div className="scrub">
        <span>{fmtMs(p.time * 1000)}</span>
        <div
          className="bar"
          onMouseDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (dur) p.seek(((e.clientX - r.left) / r.width) * dur);
          }}
        >
          <div className="track">
            <div className="fill" style={{ width: `${dur ? (p.time / dur) * 100 : 0}%` }} />
          </div>
          {dur > 0 && t?.chapters?.map((c) => <span key={c.line_id} className="tick" style={{ left: `${(c.start_ms / 1000 / dur) * 100}%` }} />)}
        </div>
        <span>{fmtMs(dur * 1000)}</span>
      </div>
      <button className="btn icon plain" onClick={p.stop} title={tr("app.player.close")}>
        <X size={15} />
      </button>
    </div>
  );
}

function currentChapter(time: number, chapters: { start_ms: number; end_ms: number; speaker: string; text: string }[] | undefined, format: (c: { speaker: string; text: string }) => string) {
  const c = chapters?.find((c) => time * 1000 >= c.start_ms && time * 1000 < c.end_ms + 400);
  return c ? format(c) : undefined;
}

function Router() {
  const { route } = useStore();
  switch (route.name) {
    case "library":
      return <LibraryView />;
    case "show":
      return <ShowView id={route.id} />;
    case "episode":
      return <EpisodeView id={route.id} />;
    case "speak":
      return <SpeakView />;
    case "design":
      return <DesignView />;
    case "clone":
      return <CloneView />;
    case "voices":
      return <VoicesView />;
    case "engine":
      return <EngineView />;
    case "agents":
      return <AgentsView />;
  }
}

function EngineBanner() {
  const { t } = useTranslation();
  const { engine, go, route } = useStore();
  if (!engine || engine.state === "ready" || route.name === "engine") return null;
  const starting = engine.state === "starting";
  return (
    <div className="card" style={{ margin: "0 26px 10px", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      {starting ? <Spinner /> : <Sparkles size={16} color="var(--orange)" />}
      <div style={{ flex: 1 }} className="small">
        {starting ? t("app.banner.starting") : engine.state === "no_model" ? t("app.banner.noModel") : t("app.banner.unavailable", { message: localized(engine).split("\n")[0] })}
      </div>
      {!starting && (
        <button className="btn sm primary" onClick={() => go({ name: "engine" })}>
          {engine.state === "no_model" ? t("app.banner.download") : t("app.banner.view")}
        </button>
      )}
    </div>
  );
}

function Shell() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <div style={{ height: 10 }} data-tauri-drag-region />
        <EngineBanner />
        <Router />
        <PlayerBar />
      </main>
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    initApi().then(() => setReady(true), (e: Error) => setError(e.message));
  }, []);
  if (error) return <div className="empty"><h3>{t("app.startFailed")}</h3><p>{error}</p></div>;
  if (!ready) return <div className="empty"><Spinner /></div>;
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
