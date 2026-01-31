const COOKIE_NAME = "tg_locale";

export type ServerLocale = "en" | "zh";

export function getLocaleFromRequest(request: Request): ServerLocale {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return "en";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const value = match?.[1]?.trim();
  return value === "zh" ? "zh" : "en";
}
