export const LOCALE_PARAM = "tg_locale";
const COOKIE_NAME = "tg_locale";

export type ServerLocale = "en" | "zh";

/** Prefer URL param (works in iframes when cookie may not be sent), then cookie. */
export function getLocaleFromRequest(request: Request): ServerLocale {
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get(LOCALE_PARAM) ?? url.searchParams.get("locale");
  if (fromUrl === "zh" || fromUrl === "en") return fromUrl;
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return "en";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const value = match?.[1]?.trim();
  return value === "zh" ? "zh" : "en";
}
