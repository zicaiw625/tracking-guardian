import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  List,
  Box,
  Link,
  Banner,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/en.json" with { type: "json" };
import { getPolarisTranslations } from "../utils/polaris-i18n";

const i18n = getPolarisTranslations(translations);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({
    lastUpdated: "December 2024",
    contactEmail: "support@tracking-guardian.app",
  });
};

export default function PublicPrivacyPolicy() {
  const { lastUpdated, contactEmail } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={i18n as any}>
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem" }}>
        <BlockStack gap="500">
          <BlockStack gap="200">
            <Text as="h1" variant="headingXl">
              Privacy Policy
            </Text>
            <Text as="p" tone="subdued">
              Last Updated: {lastUpdated}
            </Text>
          </BlockStack>

          <Card>
            <BlockStack gap="400">
              <Text as="p">
                This privacy policy describes how Tracking Guardian (&quot;we&quot;, &quot;our&quot;,
                &quot;the App&quot;) collects, uses, and protects data when merchants
                install and use our Shopify application.
              </Text>

              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  <strong>隐私优先设计：</strong>本应用（v1.0）采用<strong>完全隐私最小化</strong>设计。v1.0 版本<strong>不包含任何 PII 处理功能</strong>，不收集、不处理、不发送任何个人身份信息（包括哈希值）。
                </Text>
                <div style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px" }}>
                  <Text as="p">
                    <strong>v1.0 版本说明：</strong>v1.0 版本仅依赖 Web Pixels 标准事件，发送订单金额、商品信息等非 PII 数据。PII 增强匹配功能（包括邮箱/电话/姓名/地址等字段的哈希处理）将在 v1.1 版本中提供（需通过 Shopify PCD 审核）。这确保 v1.0 版本完全符合 Shopify App Store 审核要求，避免 PCD 合规复杂性。
                  </Text>
                </div>
              </Banner>

              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">
                  第一部分：默认数据处理模式（隐私最小化）
                </Text>
                <Banner tone="success">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    📌 这是所有商家的默认模式，无需任何配置即可使用
                  </Text>
                </Banner>
                <Text as="p">
                  默认情况下，Tracking Guardian 仅处理订单事件必要字段，<strong>不收集或处理任何个人身份信息（PII）</strong>。此模式符合 Shopify Web Pixels 的隐私最小化原则，适用于所有商家，无需额外配置。
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    <strong>代码实现说明（重要）：</strong>我们的 Web Pixel 扩展代码中实现了订阅多种 Shopify 标准事件的能力（包括 <code>page_viewed</code>、<code>product_viewed</code>、<code>product_added_to_cart</code>、<code>checkout_started</code>、<code>checkout_contact_info_submitted</code>、<code>checkout_shipping_info_submitted</code>、<code>payment_info_submitted</code>、<code>checkout_completed</code>）。但是，这些事件订阅功能通过 <code>mode</code> 参数控制：<strong>默认值为 <code>"purchase_only"</code></strong>，此时<strong>仅订阅并收集</strong> <code>checkout_completed</code>（购买完成）事件；<strong>只有在商家明确启用 Full Funnel 模式（<code>mode = "full_funnel"</code>）时，才会订阅并收集其他事件</strong>。此设计确保代码能力与隐私政策声明完全一致。在应用设置中，商家可以查看当前模式（默认显示为"仅购买事件"），并可以选择升级到 Full Funnel 模式（需要 Growth 及以上套餐）。
                  </Text>
                  <div style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px" }}>
                    <Text as="p">
                      <strong>Pixel 加载与事件发送条件（代码实现说明）：</strong>我们的 Web Pixel 配置为需要 <code>analytics</code> 同意才能加载（<code>analytics = true</code>），但不强制要求 <code>marketing</code> 同意（<code>marketing = false</code>）。这意味着<strong>只有当客户授予 analytics 同意时，Pixel 才会加载</strong>；如果客户未授予 analytics 同意，Pixel 不会加载，也不会发送任何事件。事件发送遵循以下规则：<strong>只有当客户授予 analytics 同意或 marketing 同意时，事件才会被发送到后端</strong>。如果客户未授予任何同意，事件将被跳过，不会发送。Marketing 同意需要同时满足 <code>marketingAllowed = true</code> 和 <code>saleOfDataAllowed = true</code>（符合 CCPA 要求）。服务端会根据各平台的要求（<code>requiresSaleOfData</code>）和事件用途（analytics vs marketing）进行进一步过滤，确保合规性。具体来说：
                    </Text>
                    <ul style={{ marginTop: "8px", marginLeft: "20px", fontSize: "13px" }}>
                      <li><strong>Google Analytics 4 (GA4)：</strong> 只需 analytics 同意即可发送（<code>requiresSaleOfData = false</code>）</li>
                      <li><strong>Meta Conversions API / TikTok Events API：</strong> 需要 marketing 同意（即 <code>marketingAllowed = true</code> 且 <code>saleOfDataAllowed = true</code>），因为 <code>requiresSaleOfData = true</code></li>
                    </ul>
                    <Text as="p" style={{ marginTop: "8px" }}>
                      <strong>v1.0 版本平台支持范围（代码实现说明）：</strong>v1.0 版本<strong>默认仅支持</strong>以下三个平台：Google Analytics 4 (GA4)、Meta Conversions API (Facebook/Instagram)、TikTok Events API。代码中的默认配置为 <code>enabled_platforms = "meta,tiktok,google"</code>。虽然代码实现中包含 Snapchat、Twitter/X、Pinterest 等平台的支持代码（在 <code>app/services/platforms/registry.ts</code> 和 <code>app/utils/platform-consent.ts</code> 中注册），但这些平台在 v1.0 中<strong>默认不启用</strong>，且不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持并默认启用。v1.0 商家应仅配置 GA4、Meta 和 TikTok 平台。如果商家尝试配置其他平台，系统会显示警告提示这些平台在 v1.0 中不支持。
                    </Text>
                  </div>
                </Banner>
                <div style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <Text as="p">
                    <strong>默认数据处理范围：</strong>
                  </Text>
                </div>
                <List type="bullet">
                  <List.Item>
                    <strong>订单数据（来自 Shopify Webhooks）：</strong> 订单 ID、订单号、订单金额、货币、商品信息（商品 ID、名称、数量）以及结账令牌（用于事件关联）。这些数据<strong>不包含</strong>客户姓名、邮箱、电话或地址等 PII。
                  </List.Item>
                  <List.Item>
                    <strong>像素事件数据（来自 Web Pixel）：</strong> 默认情况下（<code>mode = "purchase_only"</code>），我们<strong>仅收集</strong> <code>checkout_completed</code>（购买完成）事件。事件元数据包括时间戳、店铺域名、客户同意状态、订单信息（订单 ID、订单金额、货币、商品信息）和结账令牌（用于事件关联）。我们<strong>不收集</strong>以下事件，除非商家明确启用 Full Funnel 模式（需要 Growth 及以上套餐）：
                    <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                      <li><code>page_viewed</code> - 页面浏览事件</li>
                      <li><code>product_viewed</code> - 商品浏览事件</li>
                      <li><code>product_added_to_cart</code> - 加入购物车事件</li>
                      <li><code>checkout_started</code> - 结账开始事件</li>
                      <li><code>checkout_contact_info_submitted</code> - 结账联系信息提交事件</li>
                      <li><code>checkout_shipping_info_submitted</code> - 结账配送信息提交事件</li>
                      <li><code>payment_info_submitted</code> - 支付信息提交事件</li>
                    </ul>
                    <strong>重要说明：</strong>虽然我们的代码实现中包含订阅上述所有 Shopify 标准事件的能力，但这些事件订阅功能<strong>默认全部关闭</strong>（通过 <code>mode = "purchase_only"</code> 控制），仅在商家明确启用 Full Funnel 模式（<code>mode = "full_funnel"</code>）时才会激活。商家可以在应用设置中查看当前模式，并选择是否启用 Full Funnel 模式。
                  </List.Item>
                  <List.Item>
                    <strong>我们默认不收集的内容：</strong>
                    <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                      <li><strong>个人身份信息（PII）：</strong>客户邮箱地址、电话号码、姓名、地址或其他任何个人身份信息。这些信息仅在商家明确启用增强匹配功能且满足所有合规条件时才会处理（使用 SHA-256 哈希后传输）。</li>
                      <li><strong>浏览和交互事件：</strong>页面浏览（<code>page_viewed</code>）、商品浏览（<code>product_viewed</code>）、加购（<code>product_added_to_cart</code>）或结账流程中的中间事件（<code>checkout_started</code>、<code>checkout_contact_info_submitted</code>、<code>checkout_shipping_info_submitted</code>、<code>payment_info_submitted</code>）。这些事件仅在商家明确启用 Full Funnel 模式（需要 Growth 及以上套餐）时才会收集。</li>
                    </ul>
                    <strong>注意：</strong>v1.0 版本<strong>不包含任何 PII 处理功能</strong>，代码中已完全移除所有 PII 相关配置项和逻辑。仅在商家主动启用 Full Funnel 模式时才会订阅额外事件（但仍不处理 PII）。PII 增强匹配功能将在 v1.1 版本中提供（需通过 Shopify PCD 审核）。
                  </List.Item>
                  <List.Item>
                    <strong>数据用途：</strong> 默认模式下，所有事件仅用于 analytics（分析）目的（如 Google Analytics 4），不用于 marketing（营销）目的。事件数据仅发送到商家配置的 analytics 平台，不包含任何 PII。<strong>重要说明（代码实现说明）：</strong>Pixel 需要客户授予 analytics 同意才能加载（如果客户未授予 analytics 同意，Pixel 不会加载）。事件发送需要客户授予 analytics 同意或 marketing 同意（代码中检查 <code>hasAnalyticsConsent() || hasMarketingConsent()</code>）。如果客户未授予任何同意，事件将被跳过，不会发送到后端。这确保了完全符合 Shopify Customer Privacy API 的要求。
                  </List.Item>
                  <List.Item>
                    <strong>数据传输方式：</strong> 我们使用<strong>服务端 API（Server-Side API）</strong>将事件数据发送到广告平台。具体包括：
                    <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                      <li><strong>Google Analytics 4 (GA4)：</strong> 通过 Google Measurement Protocol API 发送事件数据（v1.0 默认支持）</li>
                      <li><strong>Meta Conversions API：</strong> 通过 Meta Conversions API 发送事件数据（v1.0 默认支持）</li>
                      <li><strong>TikTok Events API：</strong> 通过 TikTok Events API 发送事件数据（v1.0 默认支持）</li>
                      <li><strong>其他平台（Snapchat、Twitter/X、Pinterest 等）：</strong> 代码实现中包含这些平台的支持（在 <code>app/services/platforms/registry.ts</code> 中注册），但在 v1.0 中<strong>默认不启用</strong>（默认配置 <code>enabled_platforms = "meta,tiktok,google"</code>），且不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持并默认启用。v1.0 商家应仅配置 GA4、Meta 和 TikTok 平台。</li>
                    </ul>
                    所有事件数据通过 HTTPS 加密传输，确保数据安全。默认模式下，发送的数据<strong>不包含任何 PII</strong>，仅包含订单信息（订单 ID、金额、货币、商品信息）和事件元数据（时间戳、店铺域名、客户同意状态）。<strong>v1.0 版本仅支持 GA4、Meta 和 TikTok 平台</strong>，其他平台（Snapchat、Twitter/X、Pinterest 等）将在 v1.1+ 版本中正式支持。
                  </List.Item>
                  <List.Item>
                    <strong>数据分享：</strong> 默认模式下，我们<strong>不分享</strong>任何客户 PII 给第三方（因为默认模式下我们不收集 PII）。所有数据仅用于转化追踪和报告生成，不会用于广告投放、用户画像构建或其他营销目的。如果商家启用了增强匹配功能，哈希后的 PII 会通过服务端 API 发送到商家配置的广告平台，但不会用于其他目的或出售给第三方。
                  </List.Item>
                </List>

                <Text as="h2" variant="headingLg">
                  第二部分：可选增强功能（需商家主动启用并确认合规）
                </Text>
                <Banner tone="warning">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ 此功能默认关闭，必须由商家在应用设置中明确启用并确认合规义务
                  </Text>
                </Banner>
                <Text as="p">
                  商家可在应用设置中启用<strong>增强匹配/广告转化</strong>功能以提升转化追踪准确性。此功能<strong>默认关闭</strong>，必须由商家主动启用并确认合规。
                </Text>
                <div style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <Text as="p">
                    <strong>v1.0 版本说明：</strong>v1.0 版本<strong>不包含任何 PII 处理功能</strong>，代码中已完全移除所有 PII 相关配置项和逻辑（包括 <code>piiEnabled</code>、<code>pcdAcknowledged</code>、<code>isPiiFullyEnabled</code> 等）。PII 增强匹配功能将在 v1.1 版本中提供（需通过 Shopify PCD 审核）。v1.0 版本仅发送非 PII 事件数据（订单 ID、金额、商品信息等），不处理任何客户身份信息。
                  </Text>
                </div>
                <div style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <Text as="p">
                    <strong>合规说明（参考 Shopify 官方要求）：</strong>本应用遵循 Shopify Web Pixels 和 Protected Customer Data (PCD) 的严格隐私要求。增强匹配功能仅在以下条件<strong>全部满足</strong>时才会启用。我们不会在未满足这些条件的情况下处理 PII，即使商家误操作也不会触发 PII 处理。如果 Shopify 因 PCD 限制或客户未同意而未提供 PII 字段，应用会自动回退到默认隐私优先模式（仅发送非 PII 事件数据）。
                  </Text>
                </div>
                <Text as="p" fontWeight="bold">
                  启用此功能的前提条件（必须全部满足）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>应用 PCD 审核状态：</strong>本应用必须已通过 Shopify Protected Customer Data (PCD) 审核（由应用开发者申请，Shopify 审批）。详情请参考{" "}
                    <Link url="https://shopify.dev/docs/apps/online-store/protected-customer-data" external>
                      Shopify PCD 文档
                    </Link>
                    。
                  </List.Item>
                  <List.Item>
                    <strong>商家合规确认：</strong>商家必须确认其符合适用的隐私法规（GDPR、CCPA 等）并负责获取客户同意
                  </List.Item>
                  <List.Item>
                    <strong>商家明确同意：</strong>商家必须在应用设置中明确勾选并确认启用增强匹配功能，并确认已理解合规义务
                  </List.Item>
                  <List.Item>
                    <strong>Shopify 实际提供 PII：</strong>即使满足上述条件，如果 Shopify 因 PCD 限制或客户未同意而未提供 PII 字段，应用会自动回退到默认隐私优先模式
                  </List.Item>
                </List>
                <Text as="p" fontWeight="bold">
                  启用增强匹配后，我们会处理以下 PII 字段（全部使用 SHA-256 哈希后通过服务端 API 传输）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>邮箱地址：</strong>使用 SHA-256 哈希后通过服务端 API 发送到广告平台（v1.0 支持：Google GA4 Measurement Protocol、Meta Conversions API、TikTok Events API）
                  </List.Item>
                  <List.Item>
                    <strong>电话号码：</strong>使用 SHA-256 哈希后通过服务端 API 发送到广告平台
                  </List.Item>
                  <List.Item>
                    <strong>姓名（名和姓）：</strong>使用 SHA-256 哈希后通过服务端 API 发送到广告平台
                  </List.Item>
                  <List.Item>
                    <strong>地址信息（城市、州/省、邮编、国家）：</strong>使用 SHA-256 哈希后通过服务端 API 发送到广告平台
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued" style={{ marginTop: "8px" }}>
                  <strong>重要说明：</strong>所有 PII 字段在发送前都会使用 SHA-256 算法进行哈希处理。哈希处理在服务端内存中进行，<strong>我们不会在数据库中存储未哈希的 PII</strong>。哈希后的数据通过 HTTPS 加密传输到广告平台的服务端 API，确保数据安全。即使启用增强匹配，我们也只处理哈希后的数据，原始 PII 不会进入我们的数据库或日志系统。
                </Text>
                <Text as="p" variant="bodySm" tone="subdued" fontWeight="bold">
                  ⚠️ 重要说明（符合 Shopify 官方合规要求）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>哈希处理：</strong>所有 PII 字段在发送到广告平台前均使用 SHA-256 进行哈希处理，我们<strong>不在数据库中存储未哈希的 PII</strong>。哈希处理在服务端内存中进行，不会持久化存储。即使启用增强匹配，我们也只处理哈希后的数据，原始 PII 不会进入我们的数据库或日志系统。
                  </List.Item>
                  <List.Item>
                    <strong>服务端 API 传输：</strong>所有事件数据（包括哈希后的 PII，如果启用增强匹配）都通过服务端 API 发送到广告平台，而不是通过客户端 JavaScript 代码。这确保了数据传输的安全性和可靠性，并符合各平台的 Server-Side API 最佳实践。我们使用以下服务端 API：
                    <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                      <li><strong>Google Analytics 4：</strong> Measurement Protocol API（<code>https://developers.google.com/analytics/devguides/collection/protocol/ga4</code>）</li>
                      <li><strong>Meta：</strong> Conversions API（<code>https://developers.facebook.com/docs/marketing-api/conversions-api</code>）</li>
                      <li><strong>TikTok：</strong> Events API（<code>https://ads.tiktok.com/help/article?aid=9502</code>）</li>
                      <li><strong>其他平台（Snapchat、Twitter/X 等）：</strong> 代码实现中包含这些平台的服务端 API 支持（在 <code>app/services/platforms/registry.ts</code> 中注册），但在 v1.0 中默认不启用（默认配置 <code>enabled_platforms = "meta,tiktok,google"</code>），不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持。</li>
                    </ul>
                    所有 API 请求都通过 HTTPS 加密传输，确保数据安全。
                  </List.Item>
                  <List.Item>
                    <strong>自动回退机制：</strong>如果 Shopify 未提供 PII 字段（例如因 PCD 限制、客户未同意或应用未通过 PCD 审核），应用会自动回退到默认隐私优先模式，仅发送非 PII 事件数据。此回退是自动的，无需商家干预。即使商家启用了增强匹配，如果 Shopify 未提供 PII，我们也不会尝试获取或处理 PII。
                  </List.Item>
                  <List.Item>
                    <strong>数据目的地：</strong>哈希后的 PII 仅发送到商家配置的广告平台（v1.0 默认支持：Google GA4、Meta Conversions API、TikTok Events API，代码中默认配置 <code>enabled_platforms = "meta,tiktok,google"</code>），不会用于其他目的。我们不会将 PII 用于广告投放、用户画像构建或其他营销目的。我们不会将 PII 出售给第三方或用于任何非转化追踪目的。<strong>重要：</strong>此功能仅在商家明确启用增强匹配且满足所有合规条件时才会生效。默认模式下，我们不收集、不处理、不分享任何 PII。<strong>v1.0 版本限制（代码实现说明）：</strong>虽然代码实现中包含 Snapchat、Twitter/X、Pinterest 等平台的支持（在 <code>app/services/platforms/registry.ts</code> 和 <code>app/utils/platform-consent.ts</code> 中注册），但这些平台在 v1.0 中<strong>默认不启用</strong>，且不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持并默认启用。v1.0 商家应仅配置 GA4、Meta 和 TikTok 平台。
                  </List.Item>
                  <List.Item>
                    <strong>用途分级：</strong>我们区分 analytics（分析）和 marketing（营销）用途。默认情况下，所有事件仅用于 analytics（如 Google Analytics 4）。Marketing 用途（如 Meta、TikTok 广告转化）需要商家明确启用并确认合规。所有事件日志和报表中都会标记该事件是 analytics 还是 marketing 用途。
                  </List.Item>
                  <List.Item>
                    <strong>商家责任：</strong>商家需确保其符合适用的隐私法规（GDPR、CCPA 等）并已获得必要的客户同意。我们仅作为数据处理者，不承担商家合规责任。商家应确保其客户同意管理机制符合适用法规。如果商家未获得客户同意或不符合合规要求，不应启用增强匹配功能。
                  </List.Item>
                  <List.Item>
                    <strong>默认关闭：</strong>增强匹配功能默认关闭，必须由商家在应用设置中明确启用并确认合规。我们不会在未获得商家明确同意的情况下启用此功能。
                  </List.Item>
                </List>

                <Text as="h3" variant="headingMd">
                  2.1 Full Funnel 追踪（可选，需付费套餐）
                </Text>
                <Text as="p">
                  商家可在应用设置中启用<strong>Full Funnel 模式</strong>以收集更多事件用于转化优化。此功能需要<strong>Growth 及以上套餐</strong>，默认关闭。
                </Text>
                <Text as="p" fontWeight="bold">
                  Full Funnel 模式收集的事件（不含 PII）：
                </Text>
                <List type="bullet">
                  <List.Item><code>checkout_completed</code> - 购买完成事件（始终收集，无论是否启用 Full Funnel）。包含订单 ID、订单金额、货币、商品信息（商品 ID、名称、价格、数量）和结账令牌。</List.Item>
                  <List.Item><code>checkout_started</code> - 结账开始事件（仅 Full Funnel 模式）。包含结账令牌、购物车金额、货币和商品信息。</List.Item>
                  <List.Item><code>checkout_contact_info_submitted</code> - 结账联系信息提交事件（仅 Full Funnel 模式）。包含结账令牌、购物车金额、货币和商品信息。</List.Item>
                  <List.Item><code>checkout_shipping_info_submitted</code> - 结账配送信息提交事件（仅 Full Funnel 模式）。包含结账令牌、购物车金额、货币和商品信息。</List.Item>
                  <List.Item><code>payment_info_submitted</code> - 支付信息提交事件（仅 Full Funnel 模式）。包含结账令牌、购物车金额、货币和商品信息。</List.Item>
                  <List.Item><code>product_added_to_cart</code> - 加入购物车事件（仅 Full Funnel 模式）。包含商品信息（商品 ID、名称、价格、数量）和货币。</List.Item>
                  <List.Item><code>product_viewed</code> - 商品页面浏览事件（仅 Full Funnel 模式）。包含商品信息（商品 ID、名称、价格）和货币。</List.Item>
                  <List.Item><code>page_viewed</code> - 页面浏览追踪事件（仅 Full Funnel 模式）。包含页面 URL 和页面标题，不含用户信息。</List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>注意：</strong>Full Funnel 模式必须在应用设置中明确启用，且需要 Growth 及以上套餐。默认情况下（purchase_only 模式），仅收集 <code>checkout_completed</code> 事件。Full Funnel 模式启用后，会额外收集上述 7 种标准 Shopify 事件（<code>checkout_started</code>、<code>checkout_contact_info_submitted</code>、<code>checkout_shipping_info_submitted</code>、<code>payment_info_submitted</code>、<code>product_added_to_cart</code>、<code>product_viewed</code>、<code>page_viewed</code>）。所有 Full Funnel 事件<strong>不包含任何 PII</strong>，仅包含商品和交易信息。这些事件仅用于 analytics 目的，除非商家明确启用 marketing 用途。
                </Text>

                <Text as="h3" variant="headingMd">
                  2.2 Analytics vs Marketing 用途分级（P0-3 合规要求）
                </Text>
                <Text as="p">
                  我们区分 analytics（分析）和 marketing（营销）用途，以符合 Shopify Web Pixels 的隐私要求：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>Analytics 用途（默认）：</strong>所有事件默认仅用于 analytics 目的（如 Google Analytics 4）。这些事件不包含 PII，仅用于网站分析和转化追踪。
                  </List.Item>
                  <List.Item>
                    <strong>Marketing 用途（需明确启用）：</strong>如果商家启用增强匹配并将事件发送到广告平台（v1.0 默认支持：Meta、TikTok，代码中默认配置 <code>enabled_platforms = "meta,tiktok,google"</code>），这些事件会被标记为 marketing 用途。商家必须确认其合规义务并已获得客户同意。<strong>v1.0 版本限制（代码实现说明）：</strong>虽然代码实现中包含 Snapchat、Twitter/X、Pinterest 等平台的支持（在 <code>app/services/platforms/registry.ts</code> 和 <code>app/utils/platform-consent.ts</code> 中注册），但这些平台在 v1.0 中<strong>默认不启用</strong>，且不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持并默认启用。
                  </List.Item>
                  <List.Item>
                    <strong>日志标记：</strong>所有事件日志和报表中都会标记该事件是 analytics 还是 marketing 用途，用于对账解释和支持排查。
                  </List.Item>
                </List>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">
                  第三部分：透明披露与合规
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    📋 数据使用、保留、删除和合规机制
                  </Text>
                </Banner>

                <Text as="h3" variant="headingMd">
                  3.1 数据使用方式
                </Text>
                <Text as="p">我们处理数据用于以下目的：</Text>
                <List type="number">
                  <List.Item>
                    <strong>发送转化事件到广告平台：</strong>将事件数据（默认不含 PII，启用增强匹配后包含哈希后的 PII）发送到商家配置的广告平台。v1.0 版本<strong>默认支持且推荐使用</strong>以下平台：Google Analytics 4 (GA4)、Meta Conversions API (Facebook/Instagram)、TikTok Events API（代码中默认配置 <code>enabled_platforms = "meta,tiktok,google"</code>）。<strong>v1.0 版本限制（代码实现说明）：</strong>虽然代码实现中包含 Snapchat、Twitter/X、Pinterest 等平台的支持代码（在 <code>app/services/platforms/registry.ts</code> 和 <code>app/utils/platform-consent.ts</code> 中注册），但这些平台在 v1.0 中<strong>默认不启用</strong>，且不推荐在生产环境使用。这些平台将在 v1.1+ 版本中正式支持并默认启用。v1.0 商家应仅配置 GA4、Meta 和 TikTok 平台。
                  </List.Item>
                  <List.Item>
                    <strong>事件去重：</strong>在客户端像素和服务端 API 之间进行事件去重，防止重复转化上报
                  </List.Item>
                  <List.Item>
                    <strong>提供对账报告：</strong>比较 Shopify 订单与平台报告的转化数据，用于准确性验证（需要 Growth 及以上套餐）
                  </List.Item>
                  <List.Item>
                    <strong>生成审计报告：</strong>生成迁移审计报告和建议，帮助商家从旧版追踪方案迁移（免费功能）
                  </List.Item>
                  <List.Item>
                    <strong>生成验收报告：</strong>生成迁移验收报告（PDF/CSV），用于项目交付和验证（需要 Go-Live 及以上套餐）
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>注意：</strong>我们<strong>不会</strong>将数据用于广告投放、用户画像构建或其他营销目的。数据仅用于转化追踪和报告生成。
                </Text>

                <Text as="h3" variant="headingMd">
                  3.2 数据保留期限
                </Text>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    <strong>v1.0 数据保留策略：</strong>v1.0 版本采用<strong>单层数据保留</strong>策略。商家可在应用设置中配置数据保留期限（30-365 天），默认保留期为 90 天。超过保留期的事件日志和转化记录会在每日自动删除。<strong>冷热分层存储（30 天热数据 + 90 天冷数据归档）将在 v1.1+ 版本中提供</strong>。
                  </Text>
                </Banner>
                <List type="bullet">
                  <List.Item>
                    <strong>可配置保留期：</strong>商家可在应用设置中配置数据保留期限（30-365 天）。默认保留期为 90 天。超过保留期的事件日志和转化记录会在每日自动删除。
                  </List.Item>
                  <List.Item>
                    <strong>PII 处理：</strong>我们不存储未哈希的 PII。哈希后的 PII 仅传输到广告平台，不会在数据库中保留超过事件处理窗口期（通常为 24-48 小时，仅用于去重和事件关联）。
                  </List.Item>
                  <List.Item>
                    <strong>订单数据：</strong>来自 Shopify Webhooks 的订单数据（不含 PII）会保留至配置的保留期，用于对账和报告生成。
                  </List.Item>
                  <List.Item>
                    <strong>v1.1+ 规划：</strong>冷热分层存储功能将在 v1.1+ 版本中提供。该功能将支持：
                    <ul style={{ marginTop: "8px", marginLeft: "20px" }}>
                      <li><strong>热数据（30 天）：</strong>存储在数据库中，用于快速查询和实时监控</li>
                      <li><strong>冷数据（90 天）：</strong>归档到冷存储（如 S3），用于历史报告和审计</li>
                      <li><strong>自动归档：</strong>超过 30 天的数据自动归档到冷存储</li>
                    </ul>
                  </List.Item>
                </List>

                <Text as="h3" variant="headingMd">
                  3.3 数据删除与 GDPR 合规
                </Text>
                <Text as="p">
                  我们完全遵守 GDPR、CCPA 及其他适用的隐私法规。我们实现了 Shopify <strong>强制合规 webhooks</strong>（上架 App Store 的公开应用必须实现）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>应用卸载（shop/redact）：</strong>当商家卸载应用时，Shopify 会发送 <code>shop/redact</code> webhook。我们会在收到 webhook 后<strong>48 小时内</strong>自动删除所有店铺数据，包括事件日志、订单数据、像素配置等。删除操作会记录日志以供审计。
                  </List.Item>
                  <List.Item>
                    <strong>客户数据请求（customers/data_request）：</strong>当客户请求其数据副本时，Shopify 会发送 <code>customers/data_request</code> webhook。我们会在收到 webhook 后向商家提供与请求客户相关的所有客户数据副本（如有），供商家转发给客户。
                  </List.Item>
                  <List.Item>
                    <strong>客户数据删除（customers/redact）：</strong>当客户请求删除其数据时，Shopify 会发送 <code>customers/redact</code> webhook。我们会在收到 webhook 后<strong>10 个工作日内</strong>永久删除与请求客户相关的所有客户数据（包括事件日志、订单关联等）。删除操作会记录日志以供审计。
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>重要说明：</strong>
                </Text>
                <List type="bullet">
                  <List.Item>
                    所有 GDPR webhook 处理均实现<strong>幂等性</strong>，确保重复请求不会导致数据不一致
                  </List.Item>
                  <List.Item>
                    所有删除操作均会记录日志（不含 PII）以供审计和合规验证
                  </List.Item>
                  <List.Item>
                    由于我们默认不存储 PII，大多数客户数据请求可能返回空结果或仅包含非 PII 事件日志
                  </List.Item>
                  <List.Item>
                    商家可通过 {contactEmail} 联系我们请求手动数据删除或验证删除状态
                  </List.Item>
                </List>

                <Text as="h3" variant="headingMd">
                  3.4 联系方式
                </Text>
                <Text as="p">
                  如有隐私相关问题，请通过以下方式联系我们：{" "}
                  <Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </BlockStack>
      </div>
    </AppProvider>
  );
}
