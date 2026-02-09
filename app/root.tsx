import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, isRouteErrorResponse, useLoaderData } from "@remix-run/react";
import { useEffect } from "react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { suppressMonorailErrors } from "./utils/suppress-monorail-errors.client";
import { useTranslation } from "react-i18next";
import { useChangeLanguage } from "remix-i18next/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { i18nServer } from "./i18n.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  const locale = await i18nServer.getLocale(request);
  return json({ locale });
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
  const { locale } = useLoaderData<typeof loader>();
  useChangeLanguage(locale);
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <Meta />
        <Links />
      </head>
      <body>
        <PerformanceMonitor />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>);
}

export function ErrorBoundary() {
  const error = useRouteError();
  const { t, i18n } = useTranslation();
  let title = t("errorPage.unknownTitle");
  let message = t("errorPage.unknownMessage");
  let code = "UNKNOWN_ERROR";
  let status = 500;
  const isProduction = process.env.NODE_ENV === "production";
  if (isRouteErrorResponse(error)) {
    status = error.status;
    title = error.status === 404
      ? t("errorPage.pageNotFound")
      : `${error.status} ${error.statusText || t("common.error")}`;
    message = typeof error.data === 'string'
      ? error.data
      : error.status === 404
        ? t("errorPage.pageNotFoundMessage")
        : t("errorPage.loadingError");
    code = `HTTP_${error.status}`;
  } else if (error instanceof Error) {
    message = error.message || t("errorPage.defaultMessage");
    code = error.name || t("common.error");
    if (error.stack) {
      import("./utils/debug-log.client").then(({ debugError }) => {
        debugError("Error stack:", error.stack);
      });
    }
  } else if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;
    message = typeof errObj.message === "string"
      ? errObj.message
      : typeof errObj.error === "string"
        ? errObj.error
        : t("errorPage.unknownError");
    code = typeof errObj.code === "string"
      ? errObj.code
      : typeof errObj.name === "string"
        ? errObj.name
        : "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Non-standard error caught in root ErrorBoundary:", error);
    });
  } else {
    message = t("errorPage.unknownError");
    code = "UNKNOWN";
    import("./utils/debug-log.client").then(({ debugError }) => {
      debugError("Unknown error type caught in root ErrorBoundary:", error);
    });
  }
  if (isProduction && status >= 500) {
    message = t("errorPage.unknownMessage");
    code = `ERROR_${status}`;
  }
  return (
    <html lang={i18n.language || "en"}>
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
      <body style={{ margin: 0, backgroundColor: '#f6f6f7' }}>
        <div className="error-container">
          <div className="error-card">
            <h1 className="error-title">{title}</h1>
            <p className="error-message">{message}</p>
            <p className="error-code">{t("errorPage.errorCode")} {code}</p>
            <button
              className="error-button"
              onClick={() => window.location.reload()}
            >
              {t("errorPage.retry")}
            </button>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
