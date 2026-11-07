import en from "./locales/en";
import zhCN from "./locales/zh-CN";

/**
 * Registry of UI languages. To add a language:
 *  1. copy `locales/en` to `locales/<code>` and translate it
 *     (type it as `Locale<typeof en>` — the compiler lists anything missing);
 *  2. add one entry below. The switcher, persistence and fallback pick it up.
 */
export const LANGUAGES = [
  { code: "en", name: "English", messages: en },
  { code: "zh-CN", name: "简体中文", messages: zhCN },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const FALLBACK_LANGUAGE: LanguageCode = "en";
