import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Check, Copy, PackageCheck, Terminal, Wifi } from "lucide-react";
import { apiBase, get, patch, type Settings } from "../api";
import { useStore } from "../store";

type Target = { id: string; name: string; dir: string; available: boolean; installed: boolean };

function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="hstack" style={{ alignItems: "stretch" }}>
      <div className="code" style={{ flex: 1, padding: "7px 11px" }}>{text}</div>
      <button className="btn icon" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function AgentsView() {
  const { t } = useTranslation();
  const { fail, toast, status } = useStore();
  const local = apiBase();
  const lan = status?.api.lan_url ?? null;
  const [targets, setTargets] = useState<Target[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [port, setPort] = useState("");
  const loadTargets = () => invoke<Target[]>("skill_targets").then(setTargets, fail);
  useEffect(() => {
    void loadTargets();
    get<Settings>("/settings").then((s) => { setSettings(s); setPort(String(s.api_port)); }, fail);
  }, []);
  const install = async (tg: Target) => {
    try {
      const path = await invoke<string>("install_skill", { dir: tg.dir });
      toast(t("agents.skillInstalled", { path }));
      void loadTargets();
    } catch (e) {
      fail(e);
    }
  };
  const curl = `curl -s ${lan ?? local}/api/v1/speech \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ text: t("agents.curlText"), instruct: t("agents.curlInstruct") })}'`;

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>{t("agents.title")}</h1>
        <span className="sub">{t("agents.subtitle")}</span>
        <div className="spacer" data-tauri-drag-region />
      </div>
      <div className="content">
        <div className="page" style={{ maxWidth: 860 }}>
          <div className="card pad vstack">
            <div className="hstack">
              <span className="dot ready" />
              <span style={{ fontWeight: 650, flex: 1 }}>{t("agents.running")}</span>
              <span className="badge accent"><Wifi size={10} />&nbsp;{t("agents.lanBadge")}</span>
              <span className="badge">{t("agents.noAuth")}</span>
            </div>
            <div className="field"><label>{t("agents.localUrl")}</label><CopyBox text={local} /></div>
            <div className="field">
              <label>{t("agents.lanUrl")}</label>
              {lan ? <CopyBox text={lan} /> : <div className="hint">{t("agents.noLan")}</div>}
              <div className="hint">{t("agents.lanHint")}</div>
            </div>
            <div className="field">
              <label>{t("agents.discovery")}</label>
              <CopyBox text="~/Library/Application Support/com.breezecast.studio/api.json" />
              <div className="hint">{t("agents.discoveryHint")}</div>
            </div>
            {settings && (
              <div className="hstack">
                <span className="label">{t("agents.port")}</span>
                <input className="input num" style={{ width: 90, textAlign: "left" }} value={port} onChange={(e) => setPort(e.target.value)} />
                <button className="btn sm" disabled={Number(port) === settings.api_port} onClick={async () => {
                  try {
                    const s = await patch<Settings>("/settings", { api_port: Number(port) });
                    setSettings(s);
                    toast(t("agents.portSaved"));
                  } catch (e) {
                    fail(e);
                  }
                }}>{t("common.save")}</button>
              </div>
            )}
          </div>

          <div className="section-title"><PackageCheck size={17} />{t("agents.installTitle")}</div>
          <div className="group">
            {targets.map((tg) => (
              <div className="row" key={tg.dir}>
                <Bot size={18} color="var(--accent)" />
                <div className="grow">
                  <div className="title">{tg.id === "generic" ? t("agents.genericAgents") : tg.name}</div>
                  <div className="desc mono">{tg.dir}/breezecast</div>
                </div>
                {tg.installed && <span className="badge green">{t("agents.installed")}</span>}
                <button className={`btn sm ${tg.installed ? "" : "primary"}`} disabled={!tg.available} title={tg.available ? "" : t("agents.notDetectedTitle")} onClick={() => install(tg)}>
                  {tg.installed ? t("agents.update") : tg.available ? t("agents.install") : t("agents.notDetected")}
                </button>
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            <Trans i18nKey="agents.skillHint" components={{ kbd: <span className="kbd">scripts/breezecast.py</span> }} />
          </div>

          <div className="section-title"><Terminal size={17} />{t("agents.quickTry")}</div>
          <div className="code">{curl}</div>

          <div className="section-title"><Bot size={17} />{t("agents.noSkillTitle")}</div>
          <div className="muted small" style={{ marginBottom: 8 }}>{t("agents.noSkillHint")}</div>
          <CopyBox text={t("agents.agentPrompt", { base: lan ?? local })} />
          <div className="hint" style={{ marginTop: 8 }}>{t("agents.docsHint", { url: lan ?? local })}</div>
        </div>
      </div>
    </>
  );
}
