/**
 * Backend errors, looked up as `error.<key>` from `message_key` in API error bodies, SSE error
 * events and `Episode.failed_key`. Keys are defined in the Rust backend (`AppError`); keep both in
 * sync. A key missing here falls back to the backend's own `message`.
 */
export default {
  // Not found
  show_not_found: "Show not found.",
  voice_not_found: "Voice {{id}} not found.",
  episode_not_found: "Episode {{id}} not found.",
  line_not_found: "Line not found.",
  line_not_rendered: "This line has not been rendered yet.",
  job_not_found: "Job not found.",
  clip_not_found: "Clip not found.",
  audio_file_not_found: "Audio file not found.",
  voice_no_reference: "This voice has no reference audio.",
  package_unknown: "Unknown model package.",
  // Invalid input
  title_required: "A title is required.",
  name_required: "A name is required.",
  text_required: "Text cannot be empty.",
  instruct_required: "A voice description cannot be empty.",
  ref_text_required: "A transcript of the reference audio is required when using reference audio.",
  ref_text_required_clone: "Cloning a voice requires a transcript of the reference audio.",
  voice_source_required: "Provide a clip, reference audio or a voice description.",
  ref_audio_base64_invalid: "The reference audio is not valid base64.",
  ref_audio_path_invalid: "The reference audio path must be an existing absolute path.",
  cast_voice_unknown: "The voice {{voice_id}} assigned to “{{speaker}}” does not exist.",
  episode_empty: "The episode has no lines.",
  model_not_downloaded: "This model package has not been downloaded yet.",
  bf16_invalid: "BF16 precision must be auto, on or off.",
  port_invalid: "The port must be 1024 or higher.",
  line_text_empty: "Line {{line}} has no text.",
  export_format_unsupported: "Unsupported export format “{{format}}” (use m4a or wav).",
  ref_audio_duration: "The reference audio is {{seconds}} s long. Use 3–20 seconds of clean speech.",
  invalid_params: "Invalid generation parameters: {{detail}}",
  param_positive: "{{name}} must be greater than 0.",
  param_guidance_scale: "guidance_scale must be 0 or higher.",
  param_max_tokens: "max_tokens must be greater than 0.",
  param_text_chunk_size: "text_chunk_size must be greater than 0.",
  param_text_chunk_mode: "text_chunk_mode must be default, tag_aware or endline.",
  // State
  cast_missing: "“{{speaker}}” has no voice assigned yet.",
  render_incomplete_lines: "Some lines have not been rendered yet.",
  render_changed: "Lines changed while rendering. Please render again.",
  episode_not_rendered: "The episode has not been rendered yet.",
  model_installed: "This model package is already installed.",
  render_queue_unavailable: "The render queue is unavailable.",
  // Engine
  engine_no_model: "No model installed. Download one in Models & Engine first.",
  engine_starting: "The engine is still loading the model. Please wait a moment.",
  engine_not_ready: "The engine is not ready ({{state}}).",
  engine_connect_failed: "Cannot connect to the inference engine: {{detail}}",
  engine_response: "The engine returned {{status}}: {{detail}}",
  engine_stream: "The engine reported an error: {{detail}}",
  // Desktop shell (Tauri commands)
  io: "{{detail}}",
  skill_copy_failed: "Failed to copy the Skill: {{detail}}",
  port_in_use: "Port {{port}} is already in use: {{detail}}",
};
