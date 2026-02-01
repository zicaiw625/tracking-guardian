import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { getDynamicCorsHeaders } from "../utils/cors";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { useTranslation, Trans } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = getDynamicCorsHeaders(request);
  const response = json({
    appName: "Tracking Guardian",
    appDomain: process.env.SHOPIFY_APP_URL || process.env.APP_URL || "https://tracking-guardian.onrender.com",
    lastUpdated: "2025-01-15",
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

function PrivacyContent() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { appName, appDomain, lastUpdated } = useLoaderData<typeof loader>();
  const currentLang = i18nInstance.resolvedLanguage ?? i18nInstance.language;
  const htmlLang = currentLang?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";

  return (
    <html lang={htmlLang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t("PublicPrivacy.Title")} - {appName}</title>
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
          .highlight {
            background: #fff4e5;
            padding: 15px;
            border-left: 4px solid #f59e0b;
            margin: 20px 0;
            border-radius: 4px;
          }
          .warning {
            background: #fef2f2;
            padding: 15px;
            border-left: 4px solid #ef4444;
            margin: 20px 0;
            border-radius: 4px;
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
          <h1>{t("PublicPrivacy.Title")}</h1>
          <div className="meta">
            <p><strong>{t("PublicPrivacy.Meta.AppName")}{t("common.punctuation.colon")}</strong>{appName}</p>
            <p><strong>{t("PublicPrivacy.Meta.LastUpdated")}{t("common.punctuation.colon")}</strong>{lastUpdated}</p>
            <p><strong>{t("PublicPrivacy.Meta.AppDomain")}{t("common.punctuation.colon")}</strong><a href={appDomain}>{appDomain}</a></p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Overview.Title")}</h2>
            <p>
              <Trans i18nKey="PublicPrivacy.Overview.Content" values={{ appName }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.CollectedData.Title")}</h2>
            <h3>{t("PublicPrivacy.CollectedData.Orders")}</h3>
            <ul>
              <li>{t("PublicPrivacy.CollectedData.OrdersList.ID")}</li>
              <li>{t("PublicPrivacy.CollectedData.OrdersList.Amount")}</li>
              <li>{t("PublicPrivacy.CollectedData.OrdersList.Items")}</li>
              <li>{t("PublicPrivacy.CollectedData.OrdersList.Token")}</li>
            </ul>

            <h3>{t("PublicPrivacy.CollectedData.Consent")}</h3>
            <ul>
              <li>{t("PublicPrivacy.CollectedData.ConsentList.Marketing")}</li>
              <li>{t("PublicPrivacy.CollectedData.ConsentList.Analytics")}</li>
              <li>{t("PublicPrivacy.CollectedData.ConsentList.SaleOfData")}</li>
            </ul>

            <h3>{t("PublicPrivacy.CollectedData.NoPII")}</h3>
            <div className="highlight">
              <p><strong>{t("PublicPrivacy.CollectedData.NoPIIDisclaimer")}</strong></p>
              <ul>
                <li>{t("PublicPrivacy.CollectedData.NoPIIList.Name")}</li>
                <li>{t("PublicPrivacy.CollectedData.NoPIIList.Email")}</li>
                <li>{t("PublicPrivacy.CollectedData.NoPIIList.Phone")}</li>
                <li>{t("PublicPrivacy.CollectedData.NoPIIList.Address")}</li>
                <li>{t("PublicPrivacy.CollectedData.NoPIIList.Payment")}</li>
              </ul>
            </div>

            <h3>{t("PublicPrivacy.CollectedData.TechData")}</h3>
            <p>
              {t("PublicPrivacy.CollectedData.TechDataContent")}
            </p>

            <h3>{t("PublicPrivacy.CollectedData.Session")}</h3>
            <p>
              <Trans i18nKey="PublicPrivacy.CollectedData.SessionContent" components={{ 1: <strong />, 3: <strong /> }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Usage.Title")}</h2>
            <h3>{t("PublicPrivacy.Usage.Tracking")}</h3>
            <p>
              <Trans i18nKey="PublicPrivacy.Usage.TrackingContent" values={{ appName }} components={{ 1: <strong />, 3: <strong /> }} />
            </p>
            <p>
              <Trans i18nKey="PublicPrivacy.Usage.TrackingPixelNote" components={{ 0: <strong /> }} />
            </p>

            <div className="warning">
              <p><strong>{t("PublicPrivacy.Usage.ServerDeliveryWarningTitle")}</strong></p>
              <p>
                {t("PublicPrivacy.Usage.ServerDeliveryWarningContent")}
              </p>
            </div>

            <h3>{t("PublicPrivacy.Usage.Reconciliation")}</h3>
            <p>
              <Trans i18nKey="PublicPrivacy.Usage.ReconciliationContent" components={{ 1: <strong />, 3: <strong />, 5: <strong /> }} />
            </p>

            <h3>{t("PublicPrivacy.Usage.Compliance")}</h3>
            <p>
              <Trans i18nKey="PublicPrivacy.Usage.ComplianceContent" components={{ 1: <code /> }} />
            </p>

            <h3>{t("PublicPrivacy.Usage.PCD")}</h3>
            <p>
              <Trans i18nKey="PublicPrivacy.Usage.PCDContent" components={{ 0: <strong />, 2: <code /> }} />
            </p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Retention.Title")}</h2>
            <p>{t("PublicPrivacy.Retention.Content")}</p>
            <ul>
              <li><Trans i18nKey="PublicPrivacy.Retention.List.PixelReceipt" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Retention.List.VerificationRun" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Retention.List.ScanReport" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Retention.List.EventLog" components={{ 0: <strong /> }} /></li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Deletion.Title")}</h2>
            <p>{t("PublicPrivacy.Deletion.Content")}</p>
            <ul>
              <li><Trans i18nKey="PublicPrivacy.Deletion.List.Uninstall" components={{ 0: <strong />, 2: <code /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Deletion.List.GDPR" components={{ 0: <strong />, 2: <code />, 4: <code /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Deletion.List.ShopRedact" components={{ 0: <strong />, 2: <code /> }} /></li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Sharing.Title")}</h2>
            <h3>{t("PublicPrivacy.Sharing.Title")}</h3>
            <p>
              {t("PublicPrivacy.Sharing.Content")}
            </p>
            <h3>{t("PublicPrivacy.Sharing.AlertsTitle")}</h3>
            <p>
              {t("PublicPrivacy.Sharing.AlertsContent")}
            </p>
            <ul>
              <li><Trans i18nKey="PublicPrivacy.Sharing.SlackWebhook" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Sharing.TelegramBot" components={{ 0: <strong /> }} /></li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Security.Title")}</h2>
            <ul>
              <li><Trans i18nKey="PublicPrivacy.Security.Transport" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Security.Storage" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Security.Access" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Security.Logs" components={{ 0: <strong />, 2: <code /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Security.Replay" components={{ 0: <strong /> }} /></li>
            </ul>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Rights.Title")}</h2>
            <p>{t("PublicPrivacy.Rights.TitleDesc")}</p>
            <ul>
              <li><Trans i18nKey="PublicPrivacy.Rights.Access" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Rights.Deletion" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Rights.Correction" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Rights.Portability" components={{ 0: <strong /> }} /></li>
              <li><Trans i18nKey="PublicPrivacy.Rights.Objection" components={{ 0: <strong /> }} /></li>
            </ul>
            <p>{t("PublicPrivacy.Rights.Automated")}</p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Docs.Title")}</h2>
            <p>{t("PublicPrivacy.Docs.Content")} <Trans i18nKey="PublicPrivacy.Docs.More" components={{ 1: <a href="/terms" /> }} /></p>
          </div>

          <div className="section">
            <h2>{t("PublicPrivacy.Contact.Title")}</h2>
            <p>
              {t("PublicPrivacy.Contact.Content")}
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
