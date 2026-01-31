import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";

const COOKIE_NAME = "tg_locale";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

type Locale = "en" | "zh";

type Translations = Record<string, unknown>;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tArray: (key: string) => string[];
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function getNested(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in params ? String(params[k]) : `{${k}}`
  );
}

export function LocaleProvider({
  locale: initialLocale,
  translations,
  children,
  onSetLocale,
}: {
  locale: Locale;
  translations: Translations;
  children: ReactNode;
  onSetLocale?: (locale: Locale) => void;
}) {
  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      try {
        localStorage.setItem(COOKIE_NAME, next);
      } catch {
        void 0;
      }
      onSetLocale?.(next);
    },
    [onSetLocale]
  );

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const value = getNested(translations as Record<string, unknown>, key);
      if (value == null) return key;
      if (typeof value === "string") return interpolate(value, params);
      if (Array.isArray(value)) return value.map(String).join(", ");
      return String(value);
    },
    [translations]
  );

  const tArray = useCallback(
    (key: string): string[] => {
      const value = getNested(translations as Record<string, unknown>, key);
      if (!Array.isArray(value)) return [];
      return value.map(String);
    },
    [translations]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale: initialLocale, setLocale, t, tArray }),
    [initialLocale, setLocale, t, tArray]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  return useLocale().t;
}
