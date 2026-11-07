import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LANGUAGE, LANGUAGES, type LanguageCode } from "./languages";
import type en from "./locales/en";

const STORAGE_KEY = "breezecast.language";

/** Map any BCP-47 tag (e.g. "zh-Hans-CN", "en-GB") to a supported language, or undefined. */
function resolveLanguage(tag: string | null | undefined): LanguageCode | undefined {
  if (!tag) return undefined;
  const wanted = tag.toLowerCase();
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === wanted);
  if (exact) return exact.code;
  const base = wanted.split("-")[0];
  return LANGUAGES.find((l) => l.code.toLowerCase().split("-")[0] === base)?.code;
}

function initialLanguage(): LanguageCode {
  const saved = resolveLanguage(localStorage.getItem(STORAGE_KEY));
  if (saved) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = resolveLanguage(tag);
    if (match) return match;
  }
  return FALLBACK_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(LANGUAGES.map((l) => [l.code, { translation: l.messages }])),
  lng: initialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES.map((l) => l.code),
  interpolation: { escapeValue: false }, // React already escapes
});

document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

/** Switch the UI language and remember the choice. */
export function setLanguage(code: LanguageCode): Promise<unknown> {
  localStorage.setItem(STORAGE_KEY, code);
  return i18n.changeLanguage(code);
}

export function currentLanguage(): LanguageCode {
  return resolveLanguage(i18n.language) ?? FALLBACK_LANGUAGE;
}

/** The language a piece of *content* (script, voice description) is written in. */
export type ContentLang = "zh" | "en";

export function defaultContentLang(): ContentLang {
  return currentLanguage().startsWith("zh") ? "zh" : "en";
}

/** Default content for a content language, independent of the UI language. */
export function sampleText(key: keyof typeof en.sample, lang: ContentLang): string {
  return i18n.t(`sample.${key}`, { lng: lang === "zh" ? "zh-CN" : "en" });
}

export default i18n;
