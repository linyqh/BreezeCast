import "i18next";
import type en from "./locales/en";

// English is the source of truth: gives `t()` compile-time key checking and autocomplete.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
