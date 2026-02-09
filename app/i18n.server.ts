import { RemixI18Next } from "remix-i18next/server";
import { createCookie } from "@remix-run/node";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const i18nCookie = createCookie("i18n", {
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
});

export const i18nServer = new RemixI18Next({
  detection: {
    supportedLanguages: ["en", "zh"],
    fallbackLanguage: "en",
    cookie: i18nCookie,
  },
  // This is the configuration for i18next used when translating messages server-side only
  i18next: {
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: "en",
  },
});
