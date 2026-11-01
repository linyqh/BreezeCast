import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Check, Copy, PackageCheck, Terminal, Wifi } from "lucide-react";
import { apiBase, get, patch, type Settings } from "../api";
import { useStore } from "../store";

type Target = { name: string; dir: string; available: boolean; installed: boolean };

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

const AGENT_PROMPT = (base: string) => `你可以通过 BreezeCast API 生成语音和播客（BreezeTTS 2，中英双语，支持声音设计、声音克隆、演绎指导和 [笑]/(laugh) 等声音事件）。API 无需鉴权。
- 地址：${base}（本机也可读取 ~/Library/Application Support/com.breezecast.studio/api.json 中的 base_url）
- 能力说明：GET ${base}/api/v1/capabilities
- 列出声音：GET /api/v1/voices；设计候选：POST /api/v1/voices/audition；保存：POST /api/v1/voices
- 朗读：POST /api/v1/speech {"text","voice_id","instruct"} → 返回 clip.path（本机 WAV 路径）
- 播客：POST /api/v1/episodes {"title","script":"角色 {指导}: 台词\\n..."} → POST /api/v1/episodes/{id}/render {"wait":true} → POST /api/v1/episodes/{id}/export {"format":"m4a"}`;

export function AgentsView() {
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
  const install = async (t: Target) => {
    try {
      const path = await invoke<string>("install_skill", { dir: t.dir });
      toast(`Skill 已安装到 ${path}`);
      void loadTargets();
    } catch (e) {
      fail(e);
    }
  };
  const curl = `curl -s ${lan ?? local}/api/v1/speech \\
  -H "Content-Type: application/json" \\
  -d '{"text":"[笑] 你好，我是 BreezeCast。","instruct":"一位热情的年轻女主播"}'`;

  return (
    <>
      <div className="toolbar" data-tauri-drag-region>
        <h1>API 与 Agent</h1>
        <span className="sub">界面里的每一项能力都可以通过 API 调用，本机和局域网均可访问</span>
        <div className="spacer" data-tauri-drag-region />
      </div>
      <div className="content">
        <div className="page" style={{ maxWidth: 860 }}>
          <div className="card pad vstack">
            <div className="hstack">
              <span className="dot ready" />
              <span style={{ fontWeight: 650, flex: 1 }}>API 服务运行中</span>
              <span className="badge accent"><Wifi size={10} />&nbsp;局域网可访问</span>
              <span className="badge">无需鉴权</span>
            </div>
            <div className="field"><label>本机地址</label><CopyBox text={local} /></div>
            <div className="field">
              <label>局域网地址</label>
              {lan ? <CopyBox text={lan} /> : <div className="hint">未检测到局域网连接</div>}
              <div className="hint">同一网络内的其他电脑、手机可以直接用这个地址调用全部接口。局域网内任何人都能访问，请只在可信网络中使用。</div>
            </div>
            <div className="field">
              <label>自动发现文件</label>
              <CopyBox text="~/Library/Application Support/com.breezecast.studio/api.json" />
              <div className="hint">App 运行时写入 base_url 与 lan_url，本机的 Agent 和 Skill 脚本会自动读取。</div>
            </div>
            {settings && (
              <div className="hstack">
                <span className="label">端口</span>
                <input className="input num" style={{ width: 90, textAlign: "left" }} value={port} onChange={(e) => setPort(e.target.value)} />
                <button className="btn sm" disabled={Number(port) === settings.api_port} onClick={async () => {
                  try {
                    const s = await patch<Settings>("/settings", { api_port: Number(port) });
                    setSettings(s);
                    toast("端口已保存，重启 BreezeCast 后生效");
                  } catch (e) {
                    fail(e);
                  }
                }}>保存</button>
              </div>
            )}
          </div>

          <div className="section-title"><PackageCheck size={17} />安装 Agent Skill</div>
          <div className="group">
            {targets.map((t) => (
              <div className="row" key={t.dir}>
                <Bot size={18} color="var(--accent)" />
                <div className="grow">
                  <div className="title">{t.name}</div>
                  <div className="desc mono">{t.dir}/breezecast</div>
                </div>
                {t.installed && <span className="badge green">已安装</span>}
                <button className={`btn sm ${t.installed ? "" : "primary"}`} disabled={!t.available} title={t.available ? "" : "未检测到该 Agent"} onClick={() => install(t)}>
                  {t.installed ? "更新" : t.available ? "安装" : "未检测到"}
                </button>
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Skill 包含使用说明、BreezeTTS 2 写作要点和零依赖命令行工具 <span className="kbd">scripts/breezecast.py</span>（status / voices / audition / speak / episode-create / render / export …）。
          </div>

          <div className="section-title"><Terminal size={17} />快速试用</div>
          <div className="code">{curl}</div>

          <div className="section-title"><Bot size={17} />给不支持 Skill 的 Agent</div>
          <div className="muted small" style={{ marginBottom: 8 }}>把下面这段复制到 Agent 的系统提示或对话里：</div>
          <CopyBox text={AGENT_PROMPT(lan ?? local)} />
          <div className="hint" style={{ marginTop: 8 }}>完整接口文档：GET {lan ?? local}/api/v1/capabilities，以及 Skill 内的 reference/api.md。</div>
        </div>
      </div>
    </>
  );
}
