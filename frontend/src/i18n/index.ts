import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

export const SUPPORTED_LANGUAGES = ["en", "es", "pt"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    detection: {
      // Persist the user's choice in localStorage and read it back on
      // future visits; fall back to browser language, then English.
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "stellarstream_lang",
    },
  });

export default i18n;