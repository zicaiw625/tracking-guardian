import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export default function App() {
    return (<html lang="zh-CN">
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        {}
        <link rel="dns-prefetch" href="https:
        <link rel="preconnect" href="https:
        <link rel="preconnect" href="https:
        <link rel="preconnect" href="https:
        {}
        <link rel="stylesheet" href="https:
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>);
}

export function ErrorBoundary() {
  const error = useRouteError();
  let title = "发生未知错误";
  let message = "系统遇到了一个意外问题。请稍后再试。";
  let code = "UNKNOWN_ERROR";

  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText}`;
    message = typeof error.data === 'string' ? error.data : "页面未找到或发生错误。";
    code = `HTTP_${error.status}`;
  } else if (error instanceof Error) {
    message = error.message;
    code = error.name;
  } else {
    message = "发生未知错误。";
    code = "UNKNOWN";
    console.error("Unknown error caught in root ErrorBoundary:", error);
  }

  return (
    <html lang="zh-CN">
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
            <p className="error-code">错误代码: {code}</p>
            <button
              className="error-button"
              onClick={() => window.location.reload()}
            >
              重试
            </button>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
