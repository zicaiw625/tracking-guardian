import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError, isRouteErrorResponse } from "@remix-run/react";
import { ErrorDisplay } from "./components/ui/ErrorDisplay";

export default function App() {
    return (<html lang="zh-CN">
      <head>
        <meta charSet="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <link rel="preconnect" href="https://cdn.shopify.com/"/>
        <link rel="stylesheet" href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"/>
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
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
      </head>
      <body>
        <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto", marginTop: "100px" }}>
          <ErrorDisplay
            title={title}
            message={message}
            code={code}
            variant="card"
            retryable={true}
            onRetry={() => window.location.reload()}
          />
        </div>
        <Scripts />
      </body>
    </html>
  );
}
