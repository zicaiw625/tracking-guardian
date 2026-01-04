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
    <AppProvider i18n={i18n}>
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
                  <strong>隐私优先设计：</strong>本应用采用<strong>默认隐私最小化</strong>设计。默认情况下，我们<strong>不收集或处理任何个人身份信息（PII）</strong>。商家可选择性启用增强匹配功能以提升转化追踪准确性，但必须确认其合规义务（GDPR、CCPA 等）并明确同意启用。
                </Text>
                <Box as="p" style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px" }}>
                  <strong>代码能力与隐私政策一致性：</strong>本应用的代码实现中<strong>包含</strong>处理 PII 的能力（通过 <code>piiEnabled</code>、<code>pcdAcknowledged</code>、<code>isPiiFullyEnabled</code> 等配置项控制），但这些功能<strong>默认全部关闭</strong>。默认模式下，即使代码中存在这些能力，我们<strong>不会处理任何 PII 数据</strong>。仅在商家主动启用增强匹配功能<strong>且满足所有合规条件</strong>时才会处理哈希后的 PII。此设计确保代码能力与隐私政策声明完全一致，符合 Shopify App Store 审核要求。
                </Box>
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
                <Box as="p" style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <strong>默认数据处理范围：</strong>
                </Box>
                <List type="bullet">
                  <List.Item>
                    <strong>订单数据（来自 Shopify Webhooks）：</strong> 订单 ID、订单号、订单金额、货币、商品信息（商品 ID、名称、数量）以及结账令牌（用于事件关联）。这些数据<strong>不包含</strong>客户姓名、邮箱、电话或地址等 PII。
                  </List.Item>
                  <List.Item>
                    <strong>像素事件数据（来自 Web Pixel）：</strong> 默认情况下，我们<strong>仅收集</strong> <code>checkout_completed</code>（购买完成）事件。事件元数据包括时间戳、店铺域名和客户同意状态。我们<strong>不收集</strong>页面浏览、商品浏览、加购等事件，除非商家明确启用 Full Funnel 模式（需要 Growth 及以上套餐）。
                  </List.Item>
                  <List.Item>
                    <strong>我们默认不收集的内容：</strong> 客户邮箱地址、电话号码、姓名、地址或其他任何个人身份信息（PII）。我们也不收集浏览历史、页面浏览或加购事件，除非商家明确启用 Full Funnel 模式。<strong>注意：</strong>虽然我们的代码实现中包含处理 PII 的能力（通过 <code>piiEnabled</code>、<code>pcdAcknowledged</code> 等配置项控制），但这些功能默认全部关闭。仅在商家主动启用增强匹配功能且满足所有合规条件时，才会处理哈希后的 PII。
                  </List.Item>
                  <List.Item>
                    <strong>数据用途：</strong> 默认模式下，所有事件仅用于 analytics（分析）目的（如 Google Analytics 4），不用于 marketing（营销）目的。事件数据仅发送到商家配置的 analytics 平台，不包含任何 PII。
                  </List.Item>
                  <List.Item>
                    <strong>数据分享：</strong> 默认模式下，我们<strong>不分享</strong>任何客户 PII 给第三方（因为默认模式下我们不收集 PII）。所有数据仅用于转化追踪和报告生成，不会用于广告投放、用户画像构建或其他营销目的。如果商家启用了增强匹配功能，哈希后的 PII 会发送到商家配置的广告平台，但不会用于其他目的或出售给第三方。
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
                <Box as="p" style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <strong>代码能力说明：</strong>本应用的代码实现中<strong>包含</strong>处理 PII 的能力（通过 <code>piiEnabled</code>、<code>pcdAcknowledged</code>、<code>isPiiFullyEnabled</code> 等配置项控制），但这些功能<strong>默认全部关闭</strong>。在应用设置中，商家必须明确勾选"启用增强匹配"并确认合规义务，系统才会处理 PII。即使商家勾选了启用选项，如果 Shopify 未提供 PII 字段（例如因 PCD 限制或客户未同意），应用代码会自动跳过 PII 处理，仅发送非 PII 事件数据。我们不会尝试从其他来源获取 PII，也不会在未获得明确授权的情况下处理 PII。
                </Box>
                <Box as="p" style={{ fontSize: "13px", lineHeight: "1.5", marginTop: "8px", marginBottom: "8px" }}>
                  <strong>合规说明（参考 Shopify 官方要求）：</strong>本应用遵循 Shopify Web Pixels 和 Protected Customer Data (PCD) 的严格隐私要求。增强匹配功能仅在以下条件<strong>全部满足</strong>时才会启用。我们不会在未满足这些条件的情况下处理 PII，即使商家误操作也不会触发 PII 处理。如果 Shopify 因 PCD 限制或客户未同意而未提供 PII 字段，应用会自动回退到默认隐私优先模式（仅发送非 PII 事件数据）。
                </Box>
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
                  启用增强匹配后，我们会处理以下 PII 字段（全部使用 SHA-256 哈希后传输）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>邮箱地址：</strong>使用 SHA-256 哈希后发送到广告平台（Google GA4、Meta Conversions API、TikTok Events API 等）
                  </List.Item>
                  <List.Item>
                    <strong>电话号码：</strong>使用 SHA-256 哈希后发送到广告平台
                  </List.Item>
                  <List.Item>
                    <strong>姓名（名和姓）：</strong>使用 SHA-256 哈希后发送到广告平台
                  </List.Item>
                  <List.Item>
                    <strong>地址信息（城市、州/省、邮编、国家）：</strong>使用 SHA-256 哈希后发送到广告平台
                  </List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued" fontWeight="bold">
                  ⚠️ 重要说明（符合 Shopify 官方合规要求）：
                </Text>
                <List type="bullet">
                  <List.Item>
                    <strong>哈希处理：</strong>所有 PII 字段在发送到广告平台前均使用 SHA-256 进行哈希处理，我们<strong>不在数据库中存储未哈希的 PII</strong>。哈希处理在内存中进行，不会持久化存储。即使启用增强匹配，我们也只处理哈希后的数据，原始 PII 不会进入我们的数据库。
                  </List.Item>
                  <List.Item>
                    <strong>自动回退机制：</strong>如果 Shopify 未提供 PII 字段（例如因 PCD 限制、客户未同意或应用未通过 PCD 审核），应用会自动回退到默认隐私优先模式，仅发送非 PII 事件数据。此回退是自动的，无需商家干预。即使商家启用了增强匹配，如果 Shopify 未提供 PII，我们也不会尝试获取或处理 PII。
                  </List.Item>
                  <List.Item>
                    <strong>数据目的地：</strong>哈希后的 PII 仅发送到商家配置的广告平台（如 Google GA4、Meta Conversions API、TikTok Events API 等），不会用于其他目的。我们不会将 PII 用于广告投放、用户画像构建或其他营销目的。我们不会将 PII 出售给第三方或用于任何非转化追踪目的。<strong>重要：</strong>此功能仅在商家明确启用增强匹配且满足所有合规条件时才会生效。默认模式下，我们不收集、不处理、不分享任何 PII。
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
                  <List.Item><code>page_viewed</code> - 页面浏览追踪（仅 URL 和页面标题，不含用户信息）</List.Item>
                  <List.Item><code>product_viewed</code> - 商品页面浏览（仅商品 ID、名称、价格，不含用户信息）</List.Item>
                  <List.Item><code>product_added_to_cart</code> - 加入购物车事件（仅商品信息，不含用户信息）</List.Item>
                  <List.Item><code>checkout_started</code> - 结账开始（仅购物车金额和商品信息）</List.Item>
                  <List.Item><code>checkout_completed</code> - 购买完成（始终收集，无论是否启用 Full Funnel）</List.Item>
                </List>
                <Text as="p" variant="bodySm" tone="subdued">
                  <strong>注意：</strong>Full Funnel 模式必须在应用设置中明确启用，且需要 Growth 及以上套餐。默认情况下，仅收集 <code>checkout_completed</code> 事件。Full Funnel 事件<strong>不包含任何 PII</strong>，仅包含商品和交易信息。这些事件仅用于 analytics 目的，除非商家明确启用 marketing 用途。
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
                    <strong>Marketing 用途（需明确启用）：</strong>如果商家启用增强匹配并将事件发送到广告平台（如 Meta、TikTok），这些事件会被标记为 marketing 用途。商家必须确认其合规义务并已获得客户同意。
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
                    <strong>发送转化事件到广告平台：</strong>将事件数据（默认不含 PII，启用增强匹配后包含哈希后的 PII）发送到商家配置的广告平台（Google GA4、Meta Conversions API、TikTok Events API 等）
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
