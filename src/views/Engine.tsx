import { useEffect, useState } from "react";
import { Check, Cpu, Download, FolderOpen, RotateCw, Trash2, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { backendLabel, del, get, patch, post, type ModelPackage, type Settings } from "../api";
import { useStore } from "../store";
import { ParamsPanel, Segmented, Spinner, Switch } from "../ui";

const gb = (b: number) => `${(b / 1e9).toFixed(1)} GB`;

export function EngineView() {
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
        <h1>模型与引擎</h1>
        <span className="sub">audio.cpp · ggml {backendLabel(engine?.backend)} · BreezeTTS 2 (3B)</span>
        <div className="spacer" data-tauri-drag-region />
        <button className="btn" onClick={() => post("/engine/restart").catch(fail)}><RotateCw size={14} />重启引擎</button>
      </div>
      <div className="content">
        <div className="page" style={{ maxWidth: 860 }}>
          <div className="card pad hstack" style={{ gap: 14 }}>
            <div className="avatar lg" style={{ background: "linear-gradient(150deg,#8e8e93,#3a3a3c)" }}><Cpu size={22} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="hstack">
                <span className={`dot ${engine?.state}`} />
                <span style={{ fontWeight: 650 }}>
                  {{ ready: "运行中", starting: "正在加载模型", stopped: "已停止", error: "出错", no_model: "未安装模型" }[engine?.state ?? "stopped"]}
                </span>
                {engine?.state === "starting" && <Spinner />}
              </div>
              <div className="muted small">
                {engine?.state === "ready" ? `本地端口 ${engine.port} · 后端 ${engine.backend.toUpperCase()} · 当前模型 ${status?.model.active_package}` : engine?.message || "—"}
              </div>
            </div>
            <button className="btn sm" onClick={async () => setLogs(logs ? null : (await get<{ lines: string[] }>("/engine/logs?lines=300")).lines)}>{logs ? "隐藏日志" : "查看日志"}</button>
          </div>
          {logs && <div className="code" style={{ marginTop: 10, maxHeight: 260, overflow: "auto", fontSize: 11 }}>{logs.join("\n") || "（暂无）"}</div>}

          <div className="section-title">模型包</div>
          <div className="group">
            {models.map((m) => {
              const job = dl(m.id);
              const prog = m.download?.progress ?? job?.progress ?? 0;
              return (
                <div className="row" key={m.id}>
                  <div className="grow">
                    <div className="hstack">
                      <span className="title">BreezeTTS 2 · {m.precision.toUpperCase()}</span>
                      {m.recommended && <span className="badge accent">推荐</span>}
                      {m.active && <span className="badge green">使用中</span>}
                    </div>
                    <div className="desc">{m.label} · {gb(m.size_bytes)}</div>
                    {job && (
                      <div className="hstack" style={{ marginTop: 6 }}>
                        <div className="progress" style={{ flex: 1 }}><div style={{ width: `${prog * 100}%` }} /></div>
                        <span className="hint">{job.message}</span>
                      </div>
                    )}
                  </div>
                  {job ? (
                    <button className="btn sm" onClick={() => post(`/jobs/${job.id}/cancel`).catch(fail)}><X size={12} />取消</button>
                  ) : m.installed ? (
                    <>
                      {!m.active && <button className="btn sm" onClick={() => post(`/models/${m.id}/activate`).then(load, fail)}><Check size={12} />使用</button>}
                      <button className="btn icon plain" title="删除" onClick={async () => { if (confirm(`删除 ${m.precision.toUpperCase()} 模型（${gb(m.size_bytes)}）？`)) { await del(`/models/${m.id}`).catch(fail); load(); } }}><Trash2 size={14} /></button>
                    </>
                  ) : (
                    <button className="btn sm primary" onClick={() => post(`/models/${m.id}/download`).then(load, fail)}><Download size={12} />下载</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>模型来自 Hugging Face audio-cpp/audio.cpp-gguf，下载完成后会校验 SHA-256，支持断点续传。模型权重仅限研究与非商业用途（BreezeBlue Research and Non-Commercial License）。</div>

          {settings && (
            <>
              <div className="section-title">推理</div>
              <div className="group">
                <div className="row">
                  <div className="grow">
                    <div className="title">BF16 参考精度</div>
                    <div className="desc">与官方实现一致的 bf16 激活，发音更准、更少重复；在 Metal 上约慢 20%。“自动”在 Metal 上为关闭，在 Vulkan / CUDA 上为开启；CPU 推理不受此项影响。</div>
                  </div>
                  <Segmented value={settings.bf16_activations} onChange={(v) => save({ bf16_activations: v })} options={[{ value: "on", label: "开启" }, { value: "auto", label: "自动" }, { value: "off", label: "关闭" }]} />
                </div>
                <div className="row">
                  <div className="grow">
                    <div className="title">常驻内存</div>
                    <div className="desc">保持模型加载以便随时生成；关闭后空闲 10 分钟自动释放约 4–8 GB 内存。</div>
                  </div>
                  <Switch on={settings.keep_model_loaded} onChange={(v) => save({ keep_model_loaded: v })} />
                </div>
              </div>

              <div className="section-title">全局默认生成参数</div>
              <ParamsPanel value={settings.default_params} onChange={(default_params) => save({ default_params })} />

              <div className="section-title">导出</div>
              <div className="group">
                <div className="row">
                  <div className="grow">
                    <div className="title">导出位置</div>
                    <div className="desc mono">{settings.export_dir ?? "~/Music/BreezeCast/<节目名>"}</div>
                  </div>
                  {settings.export_dir && <button className="btn sm" onClick={() => save({ export_dir: null })}>恢复默认</button>}
                  <button className="btn sm" onClick={async () => { const d = await open({ directory: true }); if (typeof d === "string") void save({ export_dir: d }); }}><FolderOpen size={12} />选择…</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
