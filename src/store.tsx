import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { get, mediaUrl, subscribe, type Chapter, type EngineStatus, type Episode, type Job, type Show, type Status, type Voice } from "./api";

export type Route =
  | { name: "library" }
  | { name: "show"; id: string }
  | { name: "episode"; id: string }
  | { name: "speak" }
  | { name: "design" }
  | { name: "clone" }
  | { name: "voices" }
  | { name: "engine" }
  | { name: "agents" };

type Toast = { id: number; text: string; error?: boolean };

export type Track = {
  url: string;
  title: string;
  subtitle?: string;
  color?: string;
  chapters?: Chapter[];
  key: string;
};

type Store = {
  route: Route;
  go: (r: Route) => void;
  status: Status | null;
  engine: EngineStatus | null;
  voices: Voice[];
  shows: Show[];
  episodes: Episode[];
  jobs: Job[];
  episodeVersion: Record<string, number>;
  refresh: () => Promise<void>;
  toast: (text: string, error?: boolean) => void;
  fail: (e: unknown) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ name: "library" });
  const [status, setStatus] = useState<Status | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [episodeVersion, setEpisodeVersion] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 2800);
  }, []);
  const fail = useCallback((e: unknown) => toast(e instanceof Error ? e.message : String(e), true), [toast]);

  const loadVoices = useCallback(() => get<Voice[]>("/voices").then(setVoices), []);
  const loadShows = useCallback(() => get<Show[]>("/shows").then(setShows), []);
  const loadEpisodes = useCallback(() => get<Episode[]>("/episodes").then(setEpisodes), []);
  const loadStatus = useCallback(() => get<Status>("/status").then((s) => { setStatus(s); setEngine(s.engine); }), []);
  const refresh = useCallback(async () => {
    await Promise.all([loadVoices(), loadShows(), loadEpisodes(), loadStatus(), get<Job[]>("/jobs").then(setJobs)]);
  }, [loadVoices, loadShows, loadEpisodes, loadStatus]);

  useEffect(() => {
    void refresh();
    let epTimer: number | undefined;
    return subscribe((e) => {
      if (e.type === "engine") {
        setEngine(e.engine);
        void loadStatus();
      } else if (e.type === "voices") void loadVoices();
      else if (e.type === "shows") void loadShows();
      else if (e.type === "episode") {
        setEpisodeVersion((v) => ({ ...v, [e.episode_id]: (v[e.episode_id] ?? 0) + 1 }));
        window.clearTimeout(epTimer);
        epTimer = window.setTimeout(() => void loadEpisodes(), 250);
      } else if (e.type === "job") {
        setJobs((js) => [e.job, ...js.filter((j) => j.id !== e.job.id)].slice(0, 100));
        if (e.job.status === "succeeded" && e.job.kind === "model_download") void loadStatus();
      }
    });
  }, [refresh, loadStatus, loadVoices, loadShows, loadEpisodes]);

  const store = useMemo<Store>(
    () => ({ route, go: setRoute, status, engine, voices, shows, episodes, jobs, episodeVersion, refresh, toast, fail }),
    [route, status, engine, voices, shows, episodes, jobs, episodeVersion, refresh, toast, fail],
  );
  return (
    <Ctx.Provider value={store}>
      <PlayerProvider>{children}</PlayerProvider>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

// ---------- player ----------

type Player = {
  track: Track | null;
  playing: boolean;
  time: number;
  duration: number;
  play: (t: Track) => void;
  toggle: () => void;
  seek: (sec: number) => void;
  stop: () => void;
};

const PlayerCtx = createContext<Player | null>(null);

function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(new Audio());
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audio.current;
    const onTime = () => setTime(a.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => setDuration(a.duration || 0);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onPause);
    a.addEventListener("loadedmetadata", onMeta);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onPause);
      a.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  const player = useMemo<Player>(
    () => ({
      track,
      playing,
      time,
      duration,
      play: (t) => {
        const a = audio.current;
        if (track?.key === t.key && a.src) {
          a.currentTime = 0;
        } else {
          a.src = mediaUrl(t.url, t.key);
          setTime(0);
          setDuration(0);
        }
        setTrack(t);
        void a.play();
      },
      toggle: () => (audio.current.paused ? void audio.current.play() : audio.current.pause()),
      seek: (s) => {
        audio.current.currentTime = s;
        if (audio.current.paused) void audio.current.play();
      },
      stop: () => {
        audio.current.pause();
        setTrack(null);
      },
    }),
    [track, playing, time, duration],
  );
  return <PlayerCtx.Provider value={player}>{children}</PlayerCtx.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerCtx);
  if (!p) throw new Error("PlayerProvider missing");
  return p;
}
