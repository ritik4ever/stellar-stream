import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  return (
    <label className="language-selector">
      <span className="language-selector__label">{t("footer.language")}</span>
      <select
        value={(i18n.resolvedLanguage as SupportedLanguage) ?? "en"}
        onChange={(e) => {
          void i18n.changeLanguage(e.target.value);
        }}
        aria-label={t("footer.language")}
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {LANGUAGE_LABELS[lng]}
          </option>
        ))}
      </select>
    </label>
  );
}