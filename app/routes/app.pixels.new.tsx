import type { loader } from "./app.pixels.new/loader.server";
import type { action } from "./app.pixels.new/action.server";
export { loader } from "./app.pixels.new/loader.server";
export { action } from "./app.pixels.new/action.server";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
  useNavigate,
} from "@remix-run/react";
import { useEffect } from "react";
import { Page, BlockStack, Text, Banner, List } from "@shopify/polaris";
import { useToastContext } from "~/components/ui";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { NewPixelWizard } from "~/components/pixels/NewPixelWizard";

export default function PixelsNewPage() {
  const loaderData = useLoaderData<typeof loader>();
  const { shop, templates, isStarterOrAbove, backendUrlInfo } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToastContext();

  useEffect(() => {
    if (backendUrlInfo?.placeholderDetected) {
      showError("检测到占位符：BACKEND_URL 未在构建时替换，像素扩展将无法工作");
    }
  }, [backendUrlInfo?.placeholderDetected, showError]);

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      const configIds = ("configIds" in actionData ? actionData.configIds : []) || [];
      showSuccess("配置已保存，进入测试页面...");
      if (configIds.length === 1) {
        navigate(`/app/pixels/${configIds[0]}/test`);
      } else {
        navigate("/app/pixels");
      }
    } else if (actionData && "error" in actionData && actionData.error) {
      showError(actionData.error);
    }
  }, [actionData, navigate, showSuccess, showError]);

  if (!shop) {
    return (
      <Page title="新建 Pixel">
        <Banner tone="critical" title="店铺信息未找到">
          <Text as="p">未找到店铺信息，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="新建 Pixel 配置"
      subtitle="模板选择 / 凭据 / 映射 / 环境"
      backAction={{ content: "返回 Pixels", url: "/app/pixels" }}
    >
      <BlockStack gap="500">
        {backendUrlInfo?.placeholderDetected && (
          <Banner tone="critical">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ⚠️ 严重错误：检测到占位符，URL 未在构建时替换
              </Text>
              <Text as="p" variant="bodySm">
                <strong>
                  像素扩展配置中仍包含 __BACKEND_URL_PLACEHOLDER__，这表明构建流程未正确替换占位符。</strong>
                如果占位符未被替换，像素扩展将无法发送事件到后端，导致事件丢失。这是一个严重的配置错误，必须在上线前修复。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                修复步骤（必须在生产环境部署前完成）：
              </Text>
              <List type="number">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    在 CI/CD 流程中，部署前必须运行 <code>pnpm ext:inject</code> 或{" "}
                    <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保环境变量 <code>SHOPIFY_APP_URL</code> 已正确设置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    验证扩展构建产物中不再包含占位符
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    确保该 URL 已在 Web Pixel Extension 的 allowlist 中配置
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    禁止直接使用 <code>shopify app deploy</code>，必须使用{" "}
                    <code>pnpm deploy:ext</code>
                  </Text>
                </List.Item>
              </List>
              <Text as="p" variant="bodySm" tone="subdued">
                💡 提示：如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。
              </Text>
            </BlockStack>
          </Banner>
        )}
        {!backendUrlInfo?.placeholderDetected && backendUrlInfo?.isConfigured && (
          <Banner tone="info">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                ✅ BACKEND_URL 已正确配置
              </Text>
              <Text as="p" variant="bodySm">
                扩展的 BACKEND_URL 已正确注入。生产环境部署时，请确保始终使用{" "}
                <code>pnpm deploy:ext</code> 命令，该命令会自动执行 <code>pnpm ext:inject</code>{" "}
                注入 BACKEND_URL。禁止直接使用 <code>shopify app deploy</code>。
              </Text>
              <Text as="p" variant="bodySm" fontWeight="semibold">
                重要：扩展的 BACKEND_URL 注入是生命线
              </Text>
              <Text as="p" variant="bodySm">
                如果占位符未被替换，像素扩展会静默禁用事件发送，不会显示错误。这是导致事件丢失的常见原因，必须在生产环境部署前修复。请在 CI/CD 流程中确保运行{" "}
                <code>pnpm ext:inject</code> 或 <code>pnpm deploy:ext</code>。
              </Text>
            </BlockStack>
          </Banner>
        )}
        <Banner tone="warning">
          <BlockStack gap="300">
            <Text as="p" variant="headingSm" fontWeight="bold">
              ⚠️ Strict Sandbox 能力边界说明（App Review 重要信息）
            </Text>
            <Text as="p" variant="bodySm">
              Web Pixel Extension 运行在 strict sandbox (Web Worker) 环境中，这是 Shopify
              平台的设计限制。以下能力受限：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  无法访问 DOM 元素、localStorage、sessionStorage、第三方 cookie 等浏览器 API
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  部分事件字段可能为 null 或 undefined（如 buyer.email、buyer.phone、deliveryAddress、shippingAddress、billingAddress
                  等），这是平台限制，不是故障
                </Text>
              </List.Item>
              <List.Item>
                <BlockStack gap="200">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    <strong>v1.0 不支持的事件类型（App Review 重要说明）：</strong>
                  </Text>
                  <Text as="span" variant="bodySm">
                    以下事件在 strict sandbox 中不可用，需要通过订单 webhooks 获取：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        退款事件（refund）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单取消（order_cancelled）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订单编辑（order_edited）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单创建（subscription_created）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单更新（subscription_updated）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        订阅订单取消（subscription_cancelled）
                      </Text>
                    </List.Item>
                  </List>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    这些事件将在 v1.1+ 版本中通过订单 webhooks 实现。
                  </Text>
                  <Text as="span" variant="bodySm">
                    在 App Review 时，请向 Shopify 说明这些限制是平台设计（strict sandbox
                    运行在 Web Worker 环境中，无法访问订单生命周期事件），不是应用缺陷。
                  </Text>
                </BlockStack>
              </List.Item>
            </List>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              App Review 说明要点：
            </Text>
            <Text as="p" variant="bodySm">
              这是 Shopify 平台的设计限制，不是应用故障。验收报告中会自动标注所有因 strict
              sandbox 限制而无法获取的字段和事件。在 App Review 时，请向 Shopify 说明：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  Web Pixel Extension 运行在 strict sandbox (Web Worker) 环境中，这是 Shopify
                  平台的设计
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  退款、取消、编辑订单、订阅等事件需要订单 webhooks 才能获取，将在 v1.1+
                  版本中实现
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  部分字段（如 buyer.email、buyer.phone、deliveryAddress 等）可能为
                  null，这是平台限制，不是故障
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
        <PageIntroCard
          title="配置流程概览"
          description="使用模板快速完成平台配置，先在 Test 环境验证，再切换 Live。"
          items={[
            "模板包含常用事件映射",
            "凭据支持加密存储",
            "验证通过后再切 Live",
          ]}
          primaryAction={{ content: "返回 Pixels", url: "/app/pixels" }}
        />
        {!isStarterOrAbove && (
          <Banner tone="warning" title="需要升级套餐">
            <Text as="p">
              启用像素迁移需要 Migration ($49/月) 及以上套餐。请先升级后再配置。
            </Text>
          </Banner>
        )}
        <NewPixelWizard
          templates={templates ? { presets: templates.presets ?? [], custom: Array.isArray(templates.custom) ? templates.custom.filter((t): t is NonNullable<typeof t> => t != null) : [] } : null}
          isStarterOrAbove={isStarterOrAbove}
          backendUrlInfo={backendUrlInfo}
          submit={submit}
          isSubmitting={navigation.state === "submitting"}
          showSuccess={showSuccess}
          showError={showError}
        />
      </BlockStack>
    </Page>
  );
}
