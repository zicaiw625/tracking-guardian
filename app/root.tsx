import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  useRouteLoaderData,
  useRevalidator,
  useLocation,
  useNavigate,
  isRouteErrorResponse,
} from "@remix-run/react";
import { useEffect } from "react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { suppressMonorailErrors } from "./utils/suppress-monorail-errors.client";
import { LocaleProvider } from "./context/LocaleContext";
import { getLocaleFromRequest } from "./utils/locale.server";
import en from "./locales/en.json" with { type: "json" };
import zh from "./locales/zh.json" with { type: "json" };

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  const locale = getLocaleFromRequest(request);
  const translations = locale === "zh" ? zh : en;
  return json({ locale, translations });
}

function PerformanceMonitor() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      suppressMonorailErrors();
    }
  }, []);
  return null;
}

export default function App() {
  const data = useRouteLoaderData<typeof loader>("root");
  const revalidator = useRevalidator();
  const location = useLocation();
  const navigate = useNavigate();
  const locale = data?.locale ?? "en";
  const translations = data?.translations ?? en;
  const lang = locale === "zh" ? "zh-CN" : "en";

  const handleSetLocale = (next: string) => {
    if (typeof window === "undefined") return;
    if (next === locale) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tg_locale", next);
    url.searchParams.delete("locale");
    navigate(
      {
        pathname: url.pathname,
        search: url.searchParams.toString()
          ? `?${url.searchParams.toString()}`
          : "",
        hash: url.hash,
      },
      { replace: true }
    );
    revalidator.revalidate();
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const current = url.searchParams.get("tg_locale") ?? url.searchParams.get("locale");
    if (current === locale) return;
    url.searchParams.set("tg_locale", locale);
    url.searchParams.delete("locale");
    navigate(
      {
        pathname: url.pathname,
        search: url.searchParams.toString()
          ? `?${url.searchParams.toString()}`
          : "",
        hash: url.hash,
      },
      { replace: true }
    );
  }, [locale, location.pathname, location.search, navigate]);

  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <PerformanceMonitor />
        <LocaleProvider
          locale={locale}
          translations={translations as Record<string, unknown>}
          onSetLocale={handleSetLocale}
        >
          <Outlet />
        </LocaleProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function getErrorStrings(translations: Record<string, unknown> | undefined) {
  const errors = translations?.errors as Record<string, string> | undefined;
  return {
    unknown: errors?.unknown ?? "An unknown error occurred",
    genericMessage:
      errors?.genericMessage ?? "The system encountered an unexpected issue. Please try again later.",
    notFound: errors?.notFound ?? "Page not found",
    notFoundMessage:
      errors?.notFoundMessage ?? "The page you requested does not exist.",
    loadError:
      errors?.loadError ?? "An error occurred while loading the page.",
    errorOccurred: errors?.errorOccurred ?? "An error occurred.",
    errorCode: errors?.errorCode ?? "Error code",
    retry: errors?.retry ?? "Retry",
  };
}

export function ErrorBoundary() {
  const error = useRouteError();
  const rootData = useRouteLoaderData<{ locale: string; translations: Record<string, unknown> }>("root");
  const locale = rootData?.locale ?? "en";
  const lang = locale === "zh" ? "zh-CN" : "en";
  const err = getErrorStrings(rootData?.translations);

  let title = err.unknown;
  let message = err.genericMessage;
  let code = "UNKNOWN_ERROR";
  let status = 500;
  const isProduction = process.env.NODE_ENV === "production";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    title =
      error.status === 404
        ? err.notFound
        : `${error.status} ${error.statusText || "Error"}`;
    message =
      typeof error.data === "string"
        ? error.data
        : error.status === 404
          ? err.notFoundMessage
          : err.loadError;
    code = `HTTP_${error.status}`;
  } else if (error instanceof Error) {
    message = error.message || err.errorOccurred;
    code = error.name || "Error";
    if (error.stack) {
      import("./utils/debug-log.client").then(({ debugError }) => {
        debugError("Error stack:", error.stack);
      });
    }
  } else if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;
    message =
      typeof errObj.message === "string"
        ? errObj.message
        : typeof errObj.error === "string"
          ? errObj.error
          : err.unknown;
    code =
      typeof errObj.code === "string"
        ? errObj.code
        : typeof errObj.name === "string"
          ? errObj.name
          : "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Non-standard error caught in root ErrorBoundary:", error);
    });
  } else {
    message = err.unknown;
    code = "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Unknown error type caught in root ErrorBoundary:", error);
    });
  }
  if (isProduction && status >= 500) {
    message = err.genericMessage;
    code = `ERROR_${status}`;
  }

  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
        <style>{`
          .error-container {
            padding: 2rem;
            max-width: 600px;
            margin: 100px auto 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .error-card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            border: 1px solid #e1e3e5;
          }
          .error-title {
            color: #d72c0d;
            font-size: 1.25rem;
            font-weight: 600;
            margin: 0 0 0.75rem;
          }
          .error-message {
            color: #1a1a1a;
            font-size: 1rem;
            margin: 0 0 0.5rem;
            line-height: 1.5;
          }
          .error-code {
            color: #6d7175;
            font-size: 0.875rem;
            margin: 0 0 1.25rem;
          }
          .error-button {
            background: #008060;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 0.625rem 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s ease;
          }
          .error-button:hover {
            background: #006e52;
          }
        `}</style>
      </head>
      <body style={{ margin: 0, backgroundColor: "#f6f6f7" }}>
        <div className="error-container">
          <div className="error-card">
            <h1 className="error-title">{title}</h1>
            <p className="error-message">{message}</p>
            <p className="error-code">
              {err.errorCode}: {code}
            </p>
            <button
              className="error-button"
              onClick={() => window.location.reload()}
            >
              {err.retry}
            </button>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
