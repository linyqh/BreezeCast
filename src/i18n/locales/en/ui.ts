export default {
  insertTag: "Insert {{tag}}",
  noVoice: "No voice (description only)",
  chooseVoice: "Choose a voice…",
  descriptionVoice: " (description only)",
  params: {
    title: "Generation parameters",
    customized: "{{count}} customized",
    resetAll: "Reset all",
    auto: "auto",
    guidance: {
      label: "Guidance strength guidance_scale",
      hintAuto: "Leave empty for auto: 4 when a description/direction is set, otherwise 1. Higher follows the description more closely and takes about twice as long.",
      hint: "Higher follows the description more closely",
    },
    temperature: {
      label: "Expressiveness temperature",
      hint: "Low: steady and restrained; high: more variation (default 0.9)",
    },
    depthTemperature: {
      label: "Acoustic detail depth_temperature",
      hint: "Sampling temperature of the depth decoder (default 0.9)",
    },
    topP: { hint: "Nucleus sampling threshold, 1 = off" },
    topK: { hint: "Candidate cap, 0 = off (default 50)" },
    maxTokens: {
      label: "Max frames max_tokens",
      hint: "Longest acoustic frame count per segment (12.5 frames ≈ 1 second, default 1500)",
    },
    seed: {
      label: "Random seed seed",
      placeholder: "Random each time",
      roll: "Pick a random seed",
      unlock: "Unlock (random each time)",
      unlocked: "Unlocked",
      hint: "Fixed seed + identical input = identical take",
    },
    chunk: {
      label: "Long-text splitting",
      default: "Default",
      tagAware: "Keep tags tag_aware",
      endline: "By line break endline",
      hint: "Maximum characters per segment and how to split",
    },
  },
};
