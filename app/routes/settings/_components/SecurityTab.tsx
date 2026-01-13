import {
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Select,
  Divider,
  Banner,
  Badge,
  Box,
} from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";

interface ShopData {
  id: string;
  domain: string;
  plan: string;
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | string | null;
  weakConsentMode: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

interface SecurityTabProps {
  shop: ShopData | null;
  isSubmitting: boolean;
  onRotateSecret: () => void;
}

export function SecurityTab({
  shop,
  isSubmitting,
  onRotateSecret,
}: SecurityTabProps) {
  const submit = useSubmit();
  const handleDataRetentionChange = (value: string) => {
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", shop?.consentStrategy || "balanced");
    formData.append("dataRetentionDays", value);
    submit(formData, { method: "post" });
  };
  const handleConsentStrategyChange = (value: string) => {
    if (value !== "strict") {
      const warning = `平衡模式仍要求像素回执与明确同意，但允许"部分可信"的回执（trust=partial）。\n\n在 GDPR 等严格隐私法规地区，推荐使用严格模式。\n\n确定要切换吗？`;
      if (!confirm(warning)) {
        return;
      }
    }
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", value);
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
  };
  return (
    <Layout>
      <Layout.Section>
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              安全设置
            </Text>
            <Text as="p" tone="subdued">
              管理 Pixel 事件关联令牌和数据安全设置。
            </Text>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Ingestion Key（关联令牌）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                用于关联来自 Web Pixel 的事件请求。此令牌帮助我们：
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • 过滤误配置或无效请求（抗噪）
                <br />• 将像素事件与订单正确关联（诊断）
                <br />• 在多店铺场景中识别请求来源
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                ⚠️ 重要安全说明：此令牌在浏览器网络请求中可见，不是强安全边界。
                真正的安全由多层防护提供：
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • <strong>TLS 加密</strong>：所有数据传输均通过 HTTPS 加密
                <br />• <strong>Origin 验证</strong>：仅接受来自 Shopify checkout 页面的请求（含 Referer/ShopDomain fallback，生产环境会记录 fallback 使用情况）
                <br />• <strong>HMAC 签名</strong>：用于防误报/防跨店伪造和基础抗滥用，不承诺强防伪造（密钥在客户端可见，主要依赖多层防护）
                <br />• <strong>速率限制</strong>：防止滥用和异常流量
                <br />• <strong>数据最小化</strong>：v1.0 版本不处理任何 PII 数据（包括哈希值）
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                <strong>安全边界说明：</strong>此令牌主要用于事件关联和诊断，配合上述多层防护机制共同保障安全。
                不要将此令牌视为强安全凭证，真正的安全由整体架构设计提供。
                <br />
                <strong>关于 HMAC 签名密钥：</strong>由于 ingestion_key 通过 Web Pixel settings 下发到客户端，无法做到真正保密。
                此 HMAC 签名机制的主要目的是防误报/防跨店伪造和基础抗滥用，不承诺"强防伪造"。
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      状态
                    </Text>
                    <InlineStack gap="200" blockAlign="center">
                      {shop?.hasIngestionSecret ? (
                        <>
                          <Badge tone="success">已配置</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            令牌已配置
                          </Text>
                        </>
                      ) : (
                        <>
                          <Badge tone="attention">未配置</Badge>
                          <Text as="span" variant="bodySm" tone="subdued">
                            请重新安装应用或点击生成令牌
                          </Text>
                        </>
                      )}
                    </InlineStack>
                  </BlockStack>
                  <Button
                    variant="secondary"
                    onClick={onRotateSecret}
                    loading={isSubmitting}
                  >
                    {shop?.hasIngestionSecret ? "更换令牌" : "生成令牌"}
                  </Button>
                </InlineStack>
              </Box>
              {shop?.hasActiveGraceWindow && shop.graceWindowExpiry && (
                <Banner tone="warning">
                  <p>
                    <strong>旧令牌仍有效：</strong>之前的令牌将于{" "}
                    {new Date(shop.graceWindowExpiry).toLocaleString("zh-CN")}{" "}
                    失效。 在此之前，新旧令牌均可使用，以便平滑过渡。
                  </p>
                </Banner>
              )}
              <Banner tone="info">
                <p>
                  <strong>工作原理：</strong>
                  服务端会验证此令牌，缺少或错误的令牌会导致像素事件被拒绝（204
                  响应）。 更换令牌后，App Pixel
                  会自动更新，旧令牌会有 72 小时的过渡期。
                </p>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                数据保留策略
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                配置数据保留期限，控制转化日志和相关记录的存储时间。
              </Text>
              <Select
                label="数据保留天数"
                options={[
                  { label: "30 天（推荐用于高流量店铺）", value: "30" },
                  { label: "60 天", value: "60" },
                  { label: "90 天（默认）", value: "90" },
                  { label: "180 天", value: "180" },
                  { label: "365 天（最大）", value: "365" },
                ]}
                value={String(shop?.dataRetentionDays || 90)}
                onChange={handleDataRetentionChange}
                helpText="超过此期限的数据将被自动清理"
              />
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    数据保留说明：
                  </Text>
                  <Text as="p" variant="bodySm">
                    以下数据受保留期限控制，超期后将被自动删除：
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>转化日志 (ConversionLog)</strong>
                    ：订单转化追踪记录
                    <br />•{" "}
                    <strong>像素事件回执 (PixelEventReceipt)</strong>
                    ：客户端同意证据
                    <br />• <strong>扫描报告 (ScanReport)</strong>
                    ：网站扫描结果
                    <br />•{" "}
                    <strong>对账报告 (ReconciliationReport)</strong>
                    ：平台数据对比
                    <br />• <strong>失败任务 (dead_letter)</strong>
                    ：无法重试的转化任务
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    清理任务每日自动执行。审计日志保留 365
                    天，不受此设置影响。
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    数据最小化原则：
                  </Text>
                  <Text as="p" variant="bodySm">
                    我们仅存储转化追踪必需的数据：
                    <br />• 订单 ID、金额、货币、商品信息（来自 Webhook）
                    <br />• 同意状态、事件时间戳（来自 Pixel）
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>关于 PII（邮箱/电话等）：</strong>
                    <br />• v1.0 版本：本应用不包含任何 PII 处理功能，不收集、不处理、不发送任何个人身份信息（包括哈希值）。
                    <br />• v1.0 仅依赖 Web Pixels 标准事件，发送订单金额、商品信息等非 PII 数据。
                    <br />• PII 增强匹配功能将在 v1.1 版本中提供（需通过 Shopify PCD 审核）。
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                像素隐私与同意逻辑
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                了解像素加载策略与后端过滤逻辑，以及为什么某些平台事件可能被过滤。
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    📋 像素加载策略（按平台/用途配置）
                  </Text>
                  <Text as="p" variant="bodySm">
                    Web Pixel Extension 的加载条件（在 <code>shopify.extension.toml</code> 中配置）：
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>analytics = true</strong>：需要 analytics consent 才能加载像素（用于 GA4 等分析类平台）
                    <br />• <strong>marketing = true</strong>：需要 marketing consent 才能加载像素（用于 Meta/TikTok 等营销类平台）
                    <br />• <strong>sale_of_data = "disabled"</strong>：不强制要求 sale of data 同意
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>策略说明（按平台/用途配置）：</strong>当前配置同时启用 analytics 和 marketing，以支持多平台场景。像素会在用户同意 analytics 或 marketing 任一条件时加载。后端会根据各平台的实际用途进一步过滤事件：GA4（分析类，使用 analytics consent）和 Meta/TikTok（营销类，使用 marketing consent），确保合规性。
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    🔍 后端过滤策略
                  </Text>
                  <Text as="p" variant="bodySm">
                    后端会根据各平台的合规要求进一步过滤事件：
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>GA4 (Google Analytics)</strong>：只需 analytics 同意即可发送
                    <br />• <strong>Meta (Facebook/Instagram)</strong>：需要 marketing 同意，且在顾客明确拒绝 saleOfData 时不发送
                    <br />• <strong>TikTok</strong>：需要 marketing 同意，且在顾客明确拒绝 saleOfData 时不发送
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>为什么这样设计？</strong>
                    <br />• 提高覆盖率：analytics 同意的用户也能被 GA4 追踪
                    <br />• 确保合规：marketing 平台（Meta/TikTok）仍受严格检查
                    <br />• 一致性：像素加载条件 ≤ 后端发送条件（像素加载时，至少 GA4 可以发送）
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="success">
                <BlockStack gap="200">
                  <Text as="span" fontWeight="semibold">
                    ✅ 实际效果
                  </Text>
                  <Text as="p" variant="bodySm">
                    根据用户的同意状态：
                  </Text>
                  <Text as="p" variant="bodySm">
                    • 仅同意 analytics：像素会加载，GA4 会收到事件，Meta/TikTok 不会收到事件
                    <br />• 仅同意 marketing：像素会加载，Meta/TikTok 会收到事件，GA4 可能收到事件（取决于后端策略）
                    <br />• 同时同意两者：像素会加载，所有配置的平台都会收到事件
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    后端会根据各平台的合规要求进一步过滤事件，确保符合 GDPR/CCPA 等隐私法规。
                    在 Dashboard 中，您可以查看每个平台的发送统计和过滤原因。
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    📊 查看过滤统计
                  </Text>
                  <Text as="p" variant="bodySm">
                    在 Dashboard 的监控页面，您可以查看：
                    <br />• 每个平台的事件发送成功率
                    <br />• 因 consent 过滤的事件数量
                    <br />• 各平台的同意率统计
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Consent 策略
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                控制何时发送转化数据到广告平台。不同策略适用于不同地区的合规要求。
              </Text>
              <Select
                label="策略选择"
                options={[
                  {
                    label: "🔒 严格模式（Strict）- 推荐",
                    value: "strict",
                  },
                  {
                    label: "⚖️ 平衡模式（Balanced）",
                    value: "balanced",
                  },
                ]}
                value={shop?.consentStrategy || "strict"}
                onChange={handleConsentStrategyChange}
                helpText={
                  shop?.consentStrategy === "strict"
                    ? "必须有可信的像素回执 + 明确同意才发送数据。适用于 GDPR/CCPA 等严格隐私法规地区。推荐设置。"
                    : "仍要求像素回执与明确同意；仅在回执信任等级为 partial 时也可发送（比严格模式略宽）。"
                }
              />
              <Banner
                tone={
                  shop?.consentStrategy === "strict" ? "success" : "info"
                }
              >
                {shop?.consentStrategy === "strict" && (
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      ✅ 严格模式（推荐）
                    </Text>
                    <Text as="p" variant="bodySm">
                      仅当像素事件明确表明用户同意营销追踪时才发送 CAPI。
                      如果像素未触发或用户拒绝同意，转化数据将不会发送。
                      这是最安全的设置，符合 GDPR/CCPA 等严格隐私法规要求。
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy === "balanced" && (
                  <BlockStack gap="100">
                    <Text as="span" fontWeight="semibold">
                      ⚖️ 平衡模式
                    </Text>
                    <Text as="p" variant="bodySm">
                      仍要求像素回执与明确用户同意，但允许信任等级为「部分可信」的回执。
                      这比严格模式略宽松，但仍然确保有用户同意证据才发送数据。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      建议：如果您的客户主要来自欧盟、英国等地区，推荐使用严格模式。
                    </Text>
                  </BlockStack>
                )}
                {shop?.consentStrategy !== "strict" &&
                  shop?.consentStrategy !== "balanced" && (
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        ⚠️ 未知策略
                      </Text>
                      <Text as="p" variant="bodySm">
                        当前策略设置无效，将自动按严格模式处理。请选择一个有效的策略。
                      </Text>
                    </BlockStack>
                  )}
              </Banner>
            </BlockStack>
          </BlockStack>
        </Card>
      </Layout.Section>
    </Layout>
  );
}
