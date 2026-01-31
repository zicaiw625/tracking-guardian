import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  List,
  Link,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisEn from "@shopify/polaris/locales/en.json" with { type: "json" };
import polarisZh from "@shopify/polaris/locales/zh-CN.json" with { type: "json" };
import { getPolarisTranslations } from "../utils/polaris-i18n";
import { getLocaleFromRequest } from "../utils/locale.server";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";
import { getSupportConfig } from "../utils/config.server";

const i18nEn = getPolarisTranslations(polarisEn);
const i18nZh = getPolarisTranslations(polarisZh);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const support = getSupportConfig();
  const locale = getLocaleFromRequest(request);
  const response = json({
    host: url.host,
    contactEmail: support.contactEmail,
    faqUrl: support.faqUrl,
    statusPageUrl: support.statusPageUrl,
    locale,
  });
  const headers = new Headers(response.headers);
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default function PublicSupportPage() {
  const { contactEmail, statusPageUrl, locale } = useLoaderData<typeof loader>();
  const isZh = locale === "zh";
  const i18n = isZh ? i18nZh : i18nEn;
  return (
    <AppProvider i18n={i18n as any}>
      <Page title={isZh ? "支持与常见问题" : "Support & FAQ"} subtitle="Tracking Guardian Help Center">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    {isZh ? "联系与支持" : "Contact & Support"}
                  </Text>
                  <Text as="p">
                    {isZh
                      ? "需要结账/感谢页迁移或 Web Pixel 相关帮助？当前版本侧重迁移、验收与缺口监测；服务端转化投递为可选且默认关闭。欢迎随时联系："
                      : "Need help with checkout/Thank you migration or Web Pixel events? The current version focuses on migration, verification, and gap monitoring; server-side conversion delivery is optional and off by default. Reach out anytime:"}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {isZh ? "邮箱：" : "Email: "}<Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                    </List.Item>
                    <List.Item>
                      {isZh ? "数据权利（GDPR/CCPA）：按 Shopify 使用 " : "Data rights (GDPR/CCPA): use "}
                      <Text as="span" fontWeight="bold">
                        customers/data_request
                      </Text>
                      {isZh ? " 或 " : " or "}
                      <Text as="span" fontWeight="bold">
                        customers/redact
                      </Text>
                      {isZh ? "，或直接邮件联系我们。" : " per Shopify, or email us directly."}
                    </List.Item>
                    <List.Item>
                      {isZh ? "状态页：" : "Status page: "}
                      <Link url={statusPageUrl}>
                        {statusPageUrl.replace(/^https?:\/\//, "")}
                      </Link>
                    </List.Item>
                    <List.Item>
                      <Link url="/privacy">{isZh ? "隐私政策" : "Privacy Policy"}</Link>
                      {" · "}
                      <Link url="/terms">{isZh ? "服务条款" : "Terms of Service"}</Link>
                    </List.Item>
                  </List>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    {isZh ? "常见问题" : "Quick FAQ"}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        {isZh ? "是否要求 PII/PCD？" : "Do you require PII/PCD?"}
                      </Text>{" "}
                      {isZh
                        ? "我们不收集终端客户 PII，公开 App Store 版本不请求 Shopify 订单范围或访问受保护客户数据（PCD）。任何依赖订单级对账或再购流程的未来功能将在获得明确 PCD 批准并更新隐私文档后发布。"
                        : "We do not collect end-customer PII, and the public App Store version does not request Shopify order scopes or access Protected Customer Data (PCD). Any future features that rely on order-level reconciliation or Reorder flows will ship only after explicit PCD approval and with updated privacy documentation."}
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        {isZh ? "收集哪些事件？" : "What events are collected?"}
                      </Text>{" "}
                      {isZh
                        ? "默认 Web Pixel 仅订阅 checkout_completed（purchase_only 模式）。商家可启用可选 full_funnel 模式以收集更多事件（checkout_started、page_viewed、add_to_cart、product_viewed、checkout_contact_info_submitted、checkout_shipping_info_submitted、payment_info_submitted），需商家明确同意并披露隐私政策。"
                        : "By default, Web Pixel subscribes to checkout_completed only (purchase_only mode). Optional full_funnel mode can be enabled by merchants to collect additional events (checkout_started, page_viewed, add_to_cart, product_viewed, checkout_contact_info_submitted, checkout_shipping_info_submitted, payment_info_submitted) with explicit merchant consent and proper privacy policy disclosure."}
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        {isZh ? "同意如何处置？" : "How is consent handled?"}
                      </Text>{" "}
                      {isZh ? "客户端同意遵循 Shopify " : "Client-side consent follows Shopify "}<code>customerPrivacy</code>.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        {isZh ? "数据保留与删除" : "Data retention & deletion"}
                      </Text>{" "}
                      {isZh ? "默认 90 天。卸载后 48 小时内通过 " : "Defaults to 90 days. All shop data is auto-deleted within 48h of uninstall via "}<code>shop/redact</code>{isZh ? " 自动删除所有店铺数据。" : "."}
                    </List.Item>
                  </List>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    {isZh ? "迁移提示" : "Migration tips"}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {isZh
                        ? "运行应用内扫描器检测 ScriptTags/旧像素。扫描器对 Shopify 结果分页（ScriptTags 最多 1000，Web Pixels 最多 200），达到上限时会提示。"
                        : "Run the in-app scanner to detect ScriptTags/old pixels. The scanner paginates Shopify results (ScriptTags up to 1000, Web Pixels up to 200) and warns if limits are hit."}
                    </List.Item>
                    <List.Item>
                      {isZh
                        ? "对于 Additional Scripts（感谢页/订单状态），将代码片段粘贴到扫描页的手动分析器中以免遗漏。"
                        : "For Additional Scripts (Thank you/Order status), paste the snippet into the manual analyzer on the scan page so nothing is missed."}
                    </List.Item>
                    <List.Item>
                      {isZh
                        ? "确认已在「迁移」页面安装 Tracking Guardian Web Pixel；然后可安全移除旧版 ScriptTags。"
                        : "Confirm the Tracking Guardian Web Pixel is installed from the Migration page; then you can safely remove legacy ScriptTags."}
                    </List.Item>
                  </List>
                </BlockStack>
                <InlineStack gap="200">
                  <Badge tone="success">{isZh ? "公开" : "Public"}</Badge>
                  <Badge tone="info">{isZh ? "无需登录" : "No login required"}</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}
