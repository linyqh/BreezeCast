/**
 * 后端错误，由 API 错误体、SSE 错误事件和 `Episode.failed_key` 里的 `message_key` 以
 * `error.<key>` 查找。键在 Rust 后端（`AppError`）中定义，两边需保持一致；
 * 缺失的键会回退到后端自带的 `message`。
 */
export default {
  // 未找到
  show_not_found: "节目不存在。",
  voice_not_found: "声音 {{id}} 不存在。",
  episode_not_found: "单集 {{id}} 不存在。",
  line_not_found: "台词不存在。",
  line_not_rendered: "该台词尚未生成。",
  job_not_found: "任务不存在。",
  clip_not_found: "片段不存在。",
  audio_file_not_found: "音频文件不存在。",
  voice_no_reference: "该声音没有参考音频。",
  package_unknown: "未知模型包。",
  // 输入无效
  title_required: "标题不能为空。",
  name_required: "名称不能为空。",
  text_required: "文本不能为空。",
  instruct_required: "声音描述不能为空。",
  ref_text_required: "使用参考音频时必须提供参考音频的逐字稿。",
  ref_text_required_clone: "克隆声音需要参考音频的逐字稿。",
  voice_source_required: "需要提供片段、参考音频或声音描述之一。",
  ref_audio_base64_invalid: "参考音频不是有效的 base64。",
  ref_audio_path_invalid: "参考音频路径必须是存在的绝对路径。",
  cast_voice_unknown: "角色“{{speaker}}”指定的声音 {{voice_id}} 不存在。",
  episode_empty: "单集没有台词。",
  model_not_downloaded: "该模型包尚未下载。",
  bf16_invalid: "BF16 精度只能是自动、开启或关闭。",
  port_invalid: "端口需大于等于 1024。",
  line_text_empty: "第 {{line}} 行没有文本。",
  export_format_unsupported: "不支持的导出格式“{{format}}”（可选 m4a / wav）。",
  ref_audio_duration: "参考音频时长为 {{seconds}} 秒，请使用 3–20 秒的干净人声。",
  invalid_params: "生成参数无效：{{detail}}",
  param_positive: "{{name}} 必须大于 0。",
  param_guidance_scale: "guidance_scale 不能小于 0。",
  param_max_tokens: "max_tokens 必须大于 0。",
  param_text_chunk_size: "text_chunk_size 必须大于 0。",
  param_text_chunk_mode: "text_chunk_mode 只能是 default、tag_aware 或 endline。",
  // 状态
  cast_missing: "角色“{{speaker}}”还没有分配声音。",
  render_incomplete_lines: "还有未生成的台词。",
  render_changed: "渲染过程中台词被修改，请重新渲染。",
  episode_not_rendered: "单集尚未渲染。",
  model_installed: "该模型包已安装。",
  render_queue_unavailable: "渲染队列不可用。",
  // 引擎
  engine_no_model: "尚未安装模型，请先在“模型与引擎”中下载。",
  engine_starting: "引擎正在加载模型，请稍候。",
  engine_not_ready: "引擎未就绪（{{state}}）。",
  engine_connect_failed: "无法连接推理引擎：{{detail}}",
  engine_response: "引擎返回 {{status}}：{{detail}}",
  engine_stream: "引擎报告错误：{{detail}}",
  // 桌面壳（Tauri 命令）
  io: "{{detail}}",
  skill_copy_failed: "复制 Skill 失败：{{detail}}",
  port_in_use: "端口 {{port}} 被占用：{{detail}}",
};
