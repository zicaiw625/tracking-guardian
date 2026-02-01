import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type SupportedLanguage = "en" | "zh";

function normalizeLanguage(lng: string | null | undefined): SupportedLanguage {
  if (!lng) return "en";
  return lng.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    if (key !== name) continue;
    const value = part.slice(eqIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function getLanguageFromRequest(request: Request): SupportedLanguage {
  const cookieLng = getCookieValue(request.headers.get("Cookie"), "i18next");
  if (cookieLng) return normalizeLanguage(cookieLng);
  const accept = request.headers.get("Accept-Language");
  if (!accept) return "en";
  const first = accept.split(",")[0]?.trim();
  return normalizeLanguage(first);
}

export async function createI18nServerInstance(request: Request) {
  const lng = getLanguageFromRequest(request);
  const instance = createInstance();
  instance.use(initReactI18next);
  await instance.init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    lng,
    debug: false,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
  return instance;
}
