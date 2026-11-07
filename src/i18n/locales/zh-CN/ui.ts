export default {
  insertTag: "插入 {{tag}}",
  noVoice: "不使用声音（仅描述）",
  chooseVoice: "选择声音…",
  descriptionVoice: "（描述型）",
  params: {
    title: "生成参数",
    customized: "{{count}} 项自定义",
    resetAll: "全部恢复默认",
    auto: "auto",
    guidance: {
      label: "指令强度 guidance_scale",
      hintAuto: "留空为自动：有描述/指导时 4，否则 1。越高越贴合描述，生成约慢一倍",
      hint: "越高越贴合描述",
    },
    temperature: {
      label: "表现力 temperature",
      hint: "低：稳定克制；高：起伏更大（默认 0.9）",
    },
    depthTemperature: {
      label: "声学细节 depth_temperature",
      hint: "深度解码器采样温度（默认 0.9）",
    },
    topP: { hint: "核采样阈值，1 = 关闭" },
    topK: { hint: "候选数上限，0 = 关闭（默认 50）" },
    maxTokens: {
      label: "最长帧数 max_tokens",
      hint: "每段最长声学帧（12.5 帧 ≈ 1 秒，默认 1500）",
    },
    seed: {
      label: "随机种子 seed",
      placeholder: "每次随机",
      roll: "随机一个种子",
      unlock: "解锁（每次随机）",
      unlocked: "已解锁",
      hint: "固定种子 + 相同输入 = 完全相同的一条",
    },
    chunk: {
      label: "长文本切分",
      default: "默认",
      tagAware: "保留标签 tag_aware",
      endline: "按换行 endline",
      hint: "每段最多字符数与切分方式",
    },
  },
};
