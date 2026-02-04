import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, List, Banner, Button } from "@shopify/polaris";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import * as fs from "fs";
import * as path from "path";

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
  const { appUrl, backendUrl, isLocal, extensionConfigStatus } = useLoaderData<typeof loader>();
  const [corsStatus, setCorsStatus] = useState<"pending" | "success" | "error">("pending");
  const [corsMessage, setCorsMessage] = useState("");

  const checkCors = useCallback(async () => {
    setCorsStatus("pending");
    setCorsMessage("正在检查连通性...");
    try {
      const start = Date.now();
      const res = await fetch(`${backendUrl}?check=true`, {
        method: "OPTIONS",
      });
      const end = Date.now();
      
      if (res.ok || res.status === 204 || res.status === 200) {
        setCorsStatus("success");
        setCorsMessage(`连接成功 (${end - start}ms)`);
      } else {
        setCorsStatus("error");
        setCorsMessage(`连接失败: HTTP ${res.status}`);
      }
    } catch (e) {
      setCorsStatus("error");
      setCorsMessage(`连接错误: ${e instanceof Error ? e.message : String(e)}. 可能是 CORS 配置问题或网络不通。`);
    }
  }, [backendUrl]);

  useEffect(() => {
    checkCors();
  }, [checkCors]);

  return (
    <Page title="像素连通性诊断">
      <Layout>
        <Layout.Section>
          {extensionConfigStatus === "placeholder" && (
            <Banner tone="critical" title="Extension Config Warning">
              <p>
                <code>extensions/shared/config.ts</code> contains <code>__BACKEND_URL_PLACEHOLDER__</code>. 
                You must run <code>pnpm ext:inject</code> before deploying to ensure the correct Backend URL is used.
              </p>
            </Banner>
          )}
          {extensionConfigStatus === "error" && (
            <Banner tone="warning" title="Extension Config Check Failed">
              <p>Could not read <code>extensions/shared/config.ts</code>. Please check file permissions.</p>
            </Banner>
          )}

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">配置检查</Text>
              <List>
                <List.Item>
                  <Text as="span" fontWeight="bold">SHOPIFY_APP_URL:</Text> {appUrl || "未设置 ❌"}
                </List.Item>
                <List.Item>
                  <Text as="span" fontWeight="bold">Pixel Backend URL:</Text> {backendUrl || "未设置 ❌"}
                </List.Item>
                <List.Item>
                    <Text as="span" fontWeight="bold">环境:</Text> {isLocal ? "本地开发 (Localhost)" : "生产环境"} 
                    {isLocal && <Text as="span" tone="critical"> (注意：Localhost URL 无法在真实 Web Pixel 环境中工作)</Text>}
                </List.Item>
                <List.Item>
                  <Text as="span" fontWeight="bold">Extension Config Status:</Text> {extensionConfigStatus === "injected" ? "✅ Injected" : "⚠️ Placeholder/Error"}
                </List.Item>
              </List>
              
              <Banner tone="info" title="Network Access Allowlist Required">
                <p>
                  Ensure the following URL is added to your <strong>Partner Dashboard &gt; App &gt; Extensions &gt; Web Pixel &gt; Network access</strong>:
                </p>
                <p style={{ marginTop: "8px", fontWeight: "bold" }}>{backendUrl}</p>
                <p style={{ marginTop: "8px" }}>
                  Without this, the Web Pixel will fail to send events to your backend.
                </p>
              </Banner>
            </BlockStack>
          </Card>
          
          <Card>
             <BlockStack gap="400">
                <Text as="h2" variant="headingMd">连通性测试 (CORS)</Text>
                <Banner
                    tone={corsStatus === "success" ? "success" : corsStatus === "error" ? "critical" : "info"}
                >
                    {corsMessage}
                </Banner>
                <Button onClick={checkCors} loading={corsStatus === "pending"}>重新测试</Button>
                
                <Text as="p" variant="bodySm" tone="subdued">
                    此测试模拟从浏览器（类似于 Web Pixel 环境）向后端发送跨域请求。如果失败，说明 CORS 配置有误或后端不可达。
                    请确保 `extensions/tracking-pixel/src/index.ts` 中的 `BACKEND_URL` 与上述 URL 一致，且 Shopify App URL 已配置为 HTTPS。
                </Text>
             </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
