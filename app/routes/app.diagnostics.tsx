import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, List, Banner, Button } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import * as fs from "fs";
import * as path from "path";
import { useTranslation, Trans } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const backendUrl = process.env.SHOPIFY_APP_URL ? `${process.env.SHOPIFY_APP_URL}/ingest` : "";
  
  let extensionConfigStatus: "injected" | "placeholder" | "error" = "placeholder";
  try {
    const configPath = path.join(process.cwd(), "extensions/shared/config.ts");
    if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8");
        if (content.includes("__BACKEND_URL_PLACEHOLDER__")) {
            extensionConfigStatus = "placeholder";
        } else {
            extensionConfigStatus = "injected";
        }
    } else {
        extensionConfigStatus = "error";
    }
  } catch {
    extensionConfigStatus = "error";
  }

  return json({
    appUrl,
    backendUrl,
    isLocal: appUrl.includes("localhost") || appUrl.includes("127.0.0.1"),
    extensionConfigStatus,
  });
};

export default function DiagnosticsPage() {
  const { t } = useTranslation();
  const { appUrl, backendUrl, isLocal, extensionConfigStatus } = useLoaderData<typeof loader>();
  const [corsStatus, setCorsStatus] = useState<"pending" | "success" | "error">("pending");
  const [corsMessage, setCorsMessage] = useState("");

  const checkCors = useCallback(async () => {
    if (!backendUrl) {
      setCorsStatus("error");
      setCorsMessage(t("diagnostics.cors.status.notConfigured", { defaultValue: "Backend URL is not configured. Please set SHOPIFY_APP_URL." }));
      return;
    }
    setCorsStatus("pending");
    setCorsMessage(t("diagnostics.cors.status.pending"));
    try {
      const start = Date.now();
      const res = await fetch(`${backendUrl}?check=true`, {
        method: "OPTIONS",
      });
      const end = Date.now();
      
      if (res.ok || res.status === 204 || res.status === 200) {
        setCorsStatus("success");
        setCorsMessage(t("diagnostics.cors.status.success", { ms: end - start }));
      } else {
        setCorsStatus("error");
        setCorsMessage(t("diagnostics.cors.status.fail", { status: res.status }));
      }
    } catch (e) {
      setCorsStatus("error");
      setCorsMessage(t("diagnostics.cors.status.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [backendUrl, t]);

  useEffect(() => {
    checkCors();
  }, [checkCors]);

  return (
    <Page title={t("diagnostics.pageTitle")}>
      <Layout>
        <Layout.Section>
          {extensionConfigStatus === "placeholder" && (
            <Banner tone="critical" title={t("diagnostics.extensionConfig.warning.title")}>
              <p>
                <Trans i18nKey="diagnostics.extensionConfig.warning.desc" components={{ code: <code /> }} />
              </p>
            </Banner>
          )}
          {extensionConfigStatus === "error" && (
            <Banner tone="warning" title={t("diagnostics.extensionConfig.error.title")}>
              <p>
                <Trans i18nKey="diagnostics.extensionConfig.error.desc" components={{ code: <code /> }} />
              </p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("diagnostics.configCheck.title")}</Text>
              <List>
                <List.Item>
                  <Text as="span" fontWeight="bold">{t("diagnostics.configCheck.items.appUrl")}</Text> {appUrl || t("diagnostics.configCheck.items.unset")}
                </List.Item>
                <List.Item>
                  <Text as="span" fontWeight="bold">{t("diagnostics.configCheck.items.backendUrl")}</Text> {backendUrl || t("diagnostics.configCheck.items.unset")}
                </List.Item>
                <List.Item>
                    <Text as="span" fontWeight="bold">{t("diagnostics.configCheck.items.env.label")}</Text> {isLocal ? t("diagnostics.configCheck.items.env.local") : t("diagnostics.configCheck.items.env.production")} 
                    {isLocal && <Text as="span" tone="critical">{t("diagnostics.configCheck.items.env.localWarning")}</Text>}
                </List.Item>
                <List.Item>
                  <Text as="span" fontWeight="bold">{t("diagnostics.extensionConfig.status.label")}</Text> {extensionConfigStatus === "injected" ? t("diagnostics.extensionConfig.status.injected") : t("diagnostics.extensionConfig.status.placeholder")}
                </List.Item>
              </List>
              
              <Banner tone="info" title={t("diagnostics.networkAccess.title")}>
                <p>
                  <Trans i18nKey="diagnostics.networkAccess.desc" components={{ strong: <strong /> }} />
                </p>
                <p style={{ marginTop: "8px", fontWeight: "bold" }}>{backendUrl}</p>
                <p style={{ marginTop: "8px" }}>
                  {t("diagnostics.networkAccess.fail")}
                </p>
              </Banner>
            </BlockStack>
          </Card>
          
          <Card>
             <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("diagnostics.cors.title")}</Text>
                <Banner
                    tone={corsStatus === "success" ? "success" : corsStatus === "error" ? "critical" : "info"}
                >
                    {corsMessage}
                </Banner>
                <Button onClick={checkCors} loading={corsStatus === "pending"}>{t("diagnostics.cors.actions.retest")}</Button>
                
                <Text as="p" variant="bodySm" tone="subdued">
                    {t("diagnostics.cors.help")}
                </Text>
             </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
