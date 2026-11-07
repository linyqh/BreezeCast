import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Cpu, Download, FolderOpen, RotateCw, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { backendLabel, del, get, jobMessage, localized, patch, post, type ModelPackage, type Settings } from "../api";
import { useStore } from "../store";
import { ParamsPanel, Segmented, Spinner, Switch } from "../ui";

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

export function EngineView() {
  const { t } = useTranslation();
  const { engine, jobs, fail, status } = useStore();
  const [models, setModels] = useState<ModelPackage[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<string[] | null>(null);
  const load = () => {
    get<ModelPackage[]>("/models").then(setModels, fail);
    get<Settings>("/settings").then(setSettings, fail);
  };
  useEffect(load, [engine?.state, jobs.filter((j) => j.kind === "model_download").map((j) => j.status).join()]);
  const dl = (id: string) => jobs.find((j) => j.kind === "model_download" && j.target_id === id && (j.status === "running" || j.status === "queued"));
  const save = async (p: Partial<Settings>) => {
    try {
      setSettings(await patch<Settings>("/settings", p));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("engine.title")}</h1>
        <span className="sub">audio.cpp · ggml {backendLabel(engine?.backend)} · BreezeTTS 2 (3B)</span>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => post("/engine/restart").catch(fail)}><RotateCw size={14} />{t("engine.restart")}</button>
      </div>
      <div className="content">
        <div className="page" style={{ maxWidth: 860 }}>
          <div className="card pad hstack" style={{ gap: 14 }}>
            <div className="avatar lg" style={{ background: "linear-gradient(150deg,#8e8e93,#3a3a3c)" }}><Cpu size={22} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hstack">
                <span className={`dot ${engine?.state}`} />
                <span style={{ fontWeight: 650 }}>
                  {t(`engine.state.${engine?.state ?? "stopped"}`)}
                </span>
                {engine?.state === "starting" && <Spinner />}
              </div>
              <div className="muted small">
                {engine?.state === "ready" ? t("engine.readyDetail", { port: engine.port, backend: engine.backend.toUpperCase(), model: status?.model.active_package }) : engine?.state === "error" ? localized(engine) : t("common.none")}
              </div>
            </div>
            <button className="btn sm" onClick={async () => setLogs(logs ? null : (await get<{ lines: string[] }>("/engine/logs?lines=300")).lines)}>{logs ? t("engine.hideLogs") : t("engine.showLogs")}</button>
          </div>
          {logs && <div className="code" style={{ marginTop: 10, maxHeight: 260, overflow: "auto", fontSize: 11 }}>{logs.join("\n") || t("engine.noLogs")}</div>}

          <div className="section-title">{t("engine.models")}</div>
          <div className="group">
            {models.map((m) => {
              const job = dl(m.id);
              const prog = m.download?.progress ?? job?.progress ?? 0;
              return (
                <div className="row" key={m.id}>
                  <div className="grow">
                    <div className="hstack">
                      <span className="title">BreezeTTS 2 · {m.precision.toUpperCase()}</span>
                      {m.recommended && <span className="badge accent">{t("engine.recommended")}</span>}
                      {m.active && <span className="badge green">{t("engine.active")}</span>}
                    </div>
                    <div className="desc">{t(`engine.packageLabel.${m.precision as "q4_0"}`, { defaultValue: m.label })} · {gb(m.size_bytes)}</div>
                    {job && (
                      <div className="hstack" style={{ marginTop: 6 }}>
                        <div className="progress" style={{ flex: 1 }}><div style={{ width: `${prog * 100}%` }} /></div>
                        <span className="hint">{jobMessage(job)}</span>
                      </div>
                    )}
                  </div>
                  {job ? (
                    <button className="btn sm" onClick={() => post(`/jobs/${job.id}/cancel`).catch(fail)}><X size={12} />{t("common.cancel")}</button>
                  ) : m.installed ? (
                    <>
                      {!m.active && <button className="btn sm" onClick={() => post(`/models/${m.id}/activate`).then(load, fail)}><Check size={12} />{t("engine.use")}</button>}
                      <button className="btn icon plain" title={t("engine.deleteTitle")} onClick={async () => { if (confirm(t("engine.deleteConfirm", { precision: m.precision.toUpperCase(), size: gb(m.size_bytes) }))) { await del(`/models/${m.id}`).catch(fail); load(); } }}><Trash2 size={14} /></button>
                    </>
                  ) : (
                    <button className="btn sm primary" onClick={() => post(`/models/${m.id}/download`).then(load, fail)}><Download size={12} />{t("engine.download")}</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>{t("engine.modelsHint")}</div>

          {settings && (
            <>
              <div className="section-title">{t("engine.inference")}</div>
              <div className="group">
                <div className="row">
                  <div className="grow">
                    <div className="title">{t("engine.bf16.title")}</div>
                    <div className="desc">{t("engine.bf16.desc")}</div>
                  </div>
                  <Segmented value={settings.bf16_activations} onChange={(v) => save({ bf16_activations: v })} options={[{ value: "on", label: t("engine.bf16.on") }, { value: "auto", label: t("engine.bf16.auto") }, { value: "off", label: t("engine.bf16.off") }]} />
                </div>
                <div className="row">
                  <div className="grow">
                    <div className="title">{t("engine.keepLoaded.title")}</div>
                    <div className="desc">{t("engine.keepLoaded.desc")}</div>
                  </div>
                  <Switch on={settings.keep_model_loaded} onChange={(v) => save({ keep_model_loaded: v })} />
                </div>
              </div>

              <div className="section-title">{t("engine.defaults")}</div>
              <ParamsPanel value={settings.default_params} onChange={(default_params) => save({ default_params })} />

              <div className="section-title">{t("engine.export.title")}</div>
              <div className="group">
                <div className="row">
                  <div className="grow">
                    <div className="title">{t("engine.export.location")}</div>
                    <div className="desc mono">{settings.export_dir ?? t("engine.export.defaultDir")}</div>
                  </div>
                  {settings.export_dir && <button className="btn sm" onClick={() => save({ export_dir: null })}>{t("engine.export.reset")}</button>}
                  <button className="btn sm" onClick={async () => { const d = await open({ directory: true }); if (typeof d === "string") void save({ export_dir: d }); }}><FolderOpen size={12} />{t("engine.export.choose")}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
