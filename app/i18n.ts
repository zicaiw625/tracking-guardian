/* eslint-disable import/no-named-as-default-member */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

if (!i18next.isInitialized) {
  i18next.use(initReactI18next);
  if (typeof window !== "undefined") {
    i18next.use(LanguageDetector);
  }
  i18next.init({
    resources: {
      en: {
        translation: en,
      },
      zh: {
        translation: zh,
      },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "zh"],
    debug: process.env.NODE_ENV === "development",
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    ...(typeof window !== "undefined"
      ? {
          detection: {
            order: ["cookie", "localStorage", "navigator"],
            caches: ["cookie", "localStorage"],
            cookieName: "i18next",
            cookieOptions: {
              path: "/",
              sameSite: "lax",
            },
          } as any,
        }
      : {}),
  });
}

export default i18next;
