/**
 * Security Tab Component
 *
 * Security and privacy settings tab content.
 */

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

// Define the shop data shape expected by this component
// Using a looser type to support both Date and string (JSON serialized) types
interface ShopData {
  id: string;
  domain: string;
  plan: string;
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | string | null;
  piiEnabled: boolean;
  pcdAcknowledged: boolean;
  weakConsentMode: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

interface SecurityTabProps {
  shop: ShopData | null;
  pcdApproved: boolean;
  pcdStatusMessage: string;
  isSubmitting: boolean;
  onRotateSecret: () => void;
}

export function SecurityTab({
  shop,
  pcdApproved,
  pcdStatusMessage,
  isSubmitting,
  onRotateSecret,
}: SecurityTabProps) {
  const submit = useSubmit();

  const handlePiiToggle = () => {
    // If enabling PII, check PCD approval status first
    if (!shop?.piiEnabled) {
      // If PCD not approved, block enabling
      if (!pcdApproved) {
        alert(
          "⚠️ 暂时无法启用 PII 增强匹配\n\n" +
            "【原因】\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            "本应用尚未通过 Shopify Protected Customer Data (PCD) 审核。\n" +
            "在获得批准之前，无法访问或使用受保护的客户数据字段。\n\n" +
            "【当前状态】\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            (pcdStatusMessage || "PCD 审核申请中，请等待 Shopify 审批。") +
            "\n\n" +
            "【您可以做什么】\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            "✅ 使用默认的「隐私优先模式」，转化追踪功能完全正常\n" +
            "✅ 等待我们获得 PCD 批准后再启用增强匹配\n" +
            "✅ 如有疑问请联系我们的支持团队"
        );
        return;
      }

      // PCD config allows enabling, show standard confirmation
      const confirmed = confirm(
        "⚠️ 启用 PII 增强匹配前，请仔细阅读以下内容：\n\n" +
          "【重要提醒】您确定需要启用吗？\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "✅ 不启用 PII 也能正常追踪全部转化事件\n" +
          "✅ 默认模式可满足基本归因需求，实际效果因店铺而异\n" +
          "✅ 仅当广告平台明确提示「匹配率不足」时，再考虑启用\n\n" +
          "【功能可用性说明】\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "• 此功能需要通过 Shopify PCD (Protected Customer Data) 审核\n" +
          "• 若 PII 字段不可用（返回 null），将自动降级为隐私优先模式\n" +
          "• 2025-12-10 起，Web Pixel 中的 PII 需要 PCD 批准才能获取\n\n" +
          "【您的合规责任】\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "• 确保符合 GDPR/CCPA/PIPL 等隐私法规\n" +
          "• 更新您的隐私政策，告知客户数据的使用方式\n\n" +
          "【我们如何处理 PII】\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "• 邮箱/电话在发送前会进行 SHA256 哈希处理\n" +
          "• 原始 PII 不会被存储，仅在内存中处理后立即丢弃\n" +
          "• 若 PII 字段为空，转化事件仍会发送（仅缺少增强匹配）\n\n" +
          "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
          "点击「确定」表示：\n" +
          "• 您已确认确实需要增强匹配功能\n" +
          "• 您理解若 PII 不可用将自动降级\n" +
          "• 您将更新隐私政策以符合合规要求"
      );
      if (!confirmed) return;
    }

    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("piiEnabled", String(!shop?.piiEnabled));
    formData.append("pcdAcknowledged", String(!shop?.piiEnabled));
    formData.append("consentStrategy", shop?.consentStrategy || "strict");
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
  };

  const handleDataRetentionChange = (value: string) => {
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("piiEnabled", String(shop?.piiEnabled || false));
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
    formData.append("piiEnabled", String(shop?.piiEnabled || false));
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

            {/* Ingestion Key Section */}
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
                ⚠️ 注意：此令牌在浏览器网络请求中可见，不是安全凭证。
                真正的安全由 TLS 加密、Origin 验证、速率限制和数据最小化提供。
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

            {/* PII Settings Section */}
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  隐私设置 - PII 增强匹配
                </Text>
                <Badge tone="info">可选功能</Badge>
              </InlineStack>

              <Banner tone="success" title="💡 提示：不启用 PII 也能正常追踪">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    不启用 PII 增强匹配，您的转化追踪功能完全正常！
                  </Text>
                  <Text as="p" variant="bodySm">
                    我们发送的订单数据（金额、商品、订单号）已经足够广告平台进行归因优化。
                    PII 增强匹配是可选的高级功能，仅当广告平台明确建议时才需要考虑。
                  </Text>
                </BlockStack>
              </Banner>

              <Text as="p" variant="bodySm" tone="subdued">
                PII
                增强匹配可将哈希后的邮箱/电话发送到广告平台，用于提高归因准确性。
                <strong>
                  {" "}
                  这是完全可选的功能，不启用也能正常使用所有转化追踪功能。
                </strong>
              </Text>

              <Box
                background={
                  shop?.piiEnabled ? "bg-surface-warning" : "bg-surface-success"
                }
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          PII 增强匹配
                        </Text>
                        <Badge tone={shop?.piiEnabled ? "warning" : "success"}>
                          {shop?.piiEnabled
                            ? "已启用 - 请确认合规义务"
                            : "已禁用（推荐）"}
                        </Badge>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {shop?.piiEnabled
                          ? "邮箱/电话哈希后发送到广告平台，提高归因准确性"
                          : "仅发送订单金额和商品信息，隐私优先模式"}
                      </Text>
                    </BlockStack>
                    <Button
                      variant="secondary"
                      size="slim"
                      onClick={handlePiiToggle}
                      loading={isSubmitting}
                      disabled={!shop?.piiEnabled && !pcdApproved}
                    >
                      {shop?.piiEnabled
                        ? "禁用"
                        : pcdApproved
                          ? "启用"
                          : "暂不可用"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>

              {shop?.piiEnabled && (
                <Banner
                  title="⚠️ PII 增强匹配已启用 - 请确认您的合规义务"
                  tone="warning"
                >
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      {pcdApproved
                        ? "ℹ️ 增强匹配功能已启用。若 PII 字段不可用（返回 null），将自动降级为隐私优先模式。"
                        : "⚠️ 注意：此功能需要 Shopify PCD 审核，若 PII 字段不可用将自动降级为隐私优先模式。"}
                    </Text>
                    <Text as="p" variant="bodySm">
                      作为商户，启用 PII 增强匹配后，您需要确认以下事项：
                    </Text>
                    <Text as="p" variant="bodySm">
                      ☑️
                      您的店铺隐私政策已更新，明确说明邮箱/电话用于广告归因
                      <br />
                      ☑️
                      您已确认目标市场允许此类数据处理（GDPR/CCPA/PIPL 等）
                      <br />
                      ☑️ 您理解哈希后的 PII 将发送到您配置的广告平台
                    </Text>
                    <Divider />
                    <Text as="p" variant="bodySm" tone="subdued">
                      💡
                      提醒：如果您不确定是否需要此功能，建议禁用 PII
                      并使用默认的隐私优先模式。
                      不启用 PII
                      也能完整追踪转化事件，只是归因匹配率可能略低。
                    </Text>
                  </BlockStack>
                </Banner>
              )}

              {!shop?.piiEnabled && (
                <Box
                  background="bg-fill-success-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="success">✓ 推荐配置</Badge>
                      <Text as="h3" variant="headingMd" tone="success">
                        隐私优先模式 - 您当前的最佳选择
                      </Text>
                    </InlineStack>

                    <Box
                      background="bg-surface"
                      padding="300"
                      borderRadius="100"
                    >
                      <BlockStack gap="200">
                        <Text
                          as="p"
                          variant="bodyMd"
                          fontWeight="bold"
                          tone="success"
                        >
                          🎉 恭喜！转化追踪已正常运行，无需任何额外配置！
                        </Text>
                        <Divider />
                        <InlineStack gap="400" align="space-between" wrap>
                          <BlockStack gap="100">
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="semibold"
                            >
                              📤 我们发送：
                            </Text>
                            <Text as="p" variant="bodySm">
                              订单金额、货币、商品 SKU/数量
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="semibold"
                            >
                              🚫 我们不发送：
                            </Text>
                            <Text as="p" variant="bodySm">
                              邮箱、电话、地址等 PII
                            </Text>
                          </BlockStack>
                          <BlockStack gap="100">
                            <Text
                              as="p"
                              variant="bodySm"
                              fontWeight="semibold"
                            >
                              ✅ 追踪效果：
                            </Text>
                            <Text as="p" variant="bodySm">
                              全部转化事件被准确追踪
                            </Text>
                          </BlockStack>
                        </InlineStack>
                      </BlockStack>
                    </Box>

                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        为什么推荐此模式？
                      </Text>
                      <Text as="p" variant="bodySm">
                        ✅ 合规更简单，无需特别声明 PII 用途
                        <br />✅
                        符合 GDPR（欧盟）、CCPA（美国）、PIPL（中国）等隐私法规的数据最小化原则
                        <br />✅
                        广告平台可以基于订单数据（金额、商品）进行归因优化
                        <br />✅
                        实际追踪效果因店铺情况而异，建议根据您的广告平台反馈决定
                      </Text>
                    </BlockStack>

                    <Box
                      background="bg-surface-secondary"
                      padding="200"
                      borderRadius="100"
                    >
                      <Text as="p" variant="bodySm" tone="subdued">
                        💡 <strong>什么情况下才考虑启用 PII？</strong>
                        仅当广告平台明确告知您「匹配率过低，建议使用增强匹配」时，再考虑启用。
                        实际效果因店铺流量来源、客户群体等因素而异。
                      </Text>
                    </Box>

                    <Box
                      background={
                        pcdApproved
                          ? "bg-surface-secondary"
                          : "bg-surface-caution"
                      }
                      padding="200"
                      borderRadius="100"
                    >
                      <Text
                        as="p"
                        variant="bodySm"
                        tone={pcdApproved ? "subdued" : "caution"}
                      >
                        {pcdApproved
                          ? "ℹ️ 增强匹配功能可尝试启用。注：若 Shopify 未返回 PII 字段，将自动以隐私优先模式运行。"
                          : "🔒 增强匹配暂不可用：需要完成 Shopify PCD 审核流程，完成后将开放此功能。"}
                      </Text>
                    </Box>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>

            <Divider />

            {/* Data Retention Section */}
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
                    <br />• 默认模式下：本应用不会主动采集或发送 PII 数据
                    <br />• 启用增强匹配后：需要 Shopify PCD
                    审核才能访问受保护字段；若 PII
                    字段为空（null），将自动降级为隐私优先模式
                  </Text>
                </BlockStack>
              </Banner>
            </BlockStack>

            <Divider />

            {/* Consent Strategy Section */}
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

