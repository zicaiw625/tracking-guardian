import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getSupportConfig } from "../utils/config.server";
import { useTranslation, Trans } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const support = getSupportConfig();
  const response = json({
    appName: "Tracking Guardian",
    appDomain: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "https://tracking-guardian.onrender.com",
    lastUpdated: "2025-01-15",
    contactEmail: support.contactEmail,
  });
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

function TermsContent() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { appName, appDomain, lastUpdated, contactEmail } = useLoaderData<typeof loader>();
  const currentLang = i18nInstance.resolvedLanguage ?? i18nInstance.language;
  const htmlLang = currentLang?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";

  return (
    <html lang={htmlLang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t("PublicTerms.Title")} - {appName}</title>
        <style>{`
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 {
            color: #202223;
            margin-bottom: 10px;
            font-size: 32px;
          }
          h2 {
            color: #202223;
            margin-top: 30px;
            margin-bottom: 15px;
            font-size: 24px;
            border-bottom: 2px solid #e1e3e5;
            padding-bottom: 10px;
          }
          h3 {
            color: #202223;
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 18px;
          }
          p {
            margin-bottom: 15px;
            color: #5e6e77;
          }
          ul, ol {
            margin-left: 20px;
            margin-bottom: 15px;
          }
          li {
            margin-bottom: 8px;
            color: #5e6e77;
          }
          .meta {
            color: #8c9196;
            font-size: 14px;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e1e3e5;
          }
          code {
            background: #f1f3f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
          }
          a {
            color: #008060;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          .section {
            margin-bottom: 30px;
          }
        `}</style>
      </head>
      <body>
        <div className="container">
          <h1>{t("PublicTerms.Title")}</h1>
          <div className="meta">
            <p><strong>{t("PublicTerms.Meta.AppName")}{t("common.punctuation.colon")}</strong>{appName}</p>
            <p><strong>{t("PublicTerms.Meta.LastUpdated")}{t("common.punctuation.colon")}</strong>{lastUpdated}</p>
            <p><strong>{t("PublicTerms.Meta.AppDomain")}{t("common.punctuation.colon")}</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section1.Title")}</h2>
            <p>
              <Trans i18nKey="PublicTerms.Section1.Content" values={{ appName }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section2.Title")}</h2>
            <p>
              <Trans i18nKey="PublicTerms.Section2.Content" values={{ appName }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section3.Title")}</h2>
            <p>
              {t("PublicTerms.Section3.Content")}
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section4.Title")}</h2>
            <p>
              {t("PublicTerms.Section4.Content")}
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section5.Title")}</h2>
            <p>
              {t("PublicTerms.Section5.Content")}
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicTerms.Section6.Title")}</h2>
            <p>
              <Trans i18nKey="PublicTerms.Section6.Content" values={{ email: contactEmail }} />
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

export default function TermsPage() {
  return <TermsContent />;
}
