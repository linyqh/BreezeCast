import type { ContentLang } from "./index";

/**
 * Writing aids for *content* in a given language (voice descriptions, line
 * directions). They are keyed by content language, not UI language: the
 * synthesis model wants descriptions in the same language as the text.
 */
export const TRAITS: Record<ContentLang, { group: string; items: string[] }[]> = {
  zh: [
    { group: "性别年龄", items: ["年轻女性", "成熟女性", "年轻男性", "中年男性", "少年", "老奶奶", "老爷爷"] },
    { group: "音色", items: ["声音清亮", "低沉有磁性", "温暖柔和", "略带沙哑", "甜美", "浑厚有力", "气声明显"] },
    { group: "风格", items: ["播客主持风格", "专业播音腔", "亲切像朋友聊天", "知性冷静", "活泼俏皮", "慵懒随性", "沉稳可靠"] },
    { group: "节奏", items: ["语速适中", "语速偏慢，停顿自然", "语速较快，充满活力"] },
    { group: "口音", items: ["标准普通话", "略带台湾腔", "略带东北口音", "略带粤语口音"] },
  ],
  en: [
    { group: "Who", items: ["A young woman", "A mature woman", "A young man", "A middle-aged man", "A teenager", "An elderly woman", "An elderly man"] },
    { group: "Timbre", items: ["with a bright, clear voice", "with a deep, resonant voice", "with a warm, soft voice", "with a slightly raspy voice", "with a rich, powerful voice", "breathy"] },
    { group: "Style", items: ["podcast host style", "polished broadcaster", "friendly and conversational", "calm and intellectual", "playful and bubbly", "laid-back"] },
    { group: "Pace", items: ["moderate pace", "slow, with natural pauses", "fast-paced and energetic"] },
    { group: "Accent", items: ["American accent", "British accent", "Australian accent"] },
  ],
};

export const DIRECTION_PRESETS: Record<ContentLang, string[]> = {
  zh: ["热情开场", "轻松闲聊", "惊讶", "若有所思，语速放慢", "压低声音，像在说秘密", "激动，语速加快", "严肃认真", "温柔安慰", "忍不住笑"],
  en: ["Warm, welcoming opener", "Casual and relaxed", "Surprised", "Thoughtful, slower pace", "Whispering, secretive", "Excited, faster pace", "Serious and measured", "Gentle and reassuring"],
};
