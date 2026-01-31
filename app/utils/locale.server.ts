export const LOCALE_PARAM = "tg_locale";
const COOKIE_NAME = "tg_locale";

export type ServerLocale = "en" | "zh";

/** Prefer URL param (works in iframes when cookie may not be sent), then cookie. */
export function getLocaleFromRequest(request: Request): ServerLocale {
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get(LOCALE_PARAM) ?? url.searchParams.get("locale");
  if (fromUrl === "zh" || fromUrl === "en") return fromUrl;
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    const value = match?.[1]?.trim();
    if (value === "zh" || value === "en") return value;
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const fromRef = refUrl.searchParams.get(LOCALE_PARAM) ?? refUrl.searchParams.get("locale");
      if (fromRef === "zh" || fromRef === "en") return fromRef;
    } catch {
      void 0;
    }
  }
  return "en";
}
