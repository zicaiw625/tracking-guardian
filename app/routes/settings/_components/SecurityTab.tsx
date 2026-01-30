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
  List,
  Modal,
} from "@shopify/polaris";
import { useSubmit } from "@remix-run/react";
import { useState } from "react";

interface ShopData {
  id: string;
  domain: string;
  plan: string;
  hasIngestionSecret: boolean;
  hasActiveGraceWindow: boolean;
  graceWindowExpiry: Date | string | null;
  hasExpiredPreviousSecret: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
}

interface SecurityTabProps {
  shop: ShopData | null;
  isSubmitting: boolean;
  onRotateSecret: () => void;
  pixelStrictOrigin?: boolean;
  hmacSecurityStats?: {
    lastRotationAt: Date | string | null;
    rotationCount: number;
    graceWindowActive: boolean;
    graceWindowExpiry: Date | string | null;
    suspiciousActivityCount: number;
    lastSuspiciousActivity: Date | string | null;
    nullOriginRequestCount: number;
    invalidSignatureCount: number;
    lastInvalidSignature: Date | string | null;
  } | null;
}

export function SecurityTab({
  shop,
  isSubmitting,
  onRotateSecret,
  pixelStrictOrigin,
  hmacSecurityStats,
}: SecurityTabProps) {
  const submit = useSubmit();
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [pendingConsentStrategy, setPendingConsentStrategy] = useState<string | null>(null);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const handleDataRetentionChange = (value: string) => {
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", shop?.consentStrategy || "balanced");
    formData.append("dataRetentionDays", value);
    submit(formData, { method: "post" });
  };
  const handleConsentStrategyChange = (value: string) => {
    if (value !== "strict") {
      setPendingConsentStrategy(value);
      setShowConsentModal(true);
      return;
    }
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", value);
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
  };
  const confirmConsentStrategyChange = () => {
    if (!pendingConsentStrategy) {
      setShowConsentModal(false);
      return;
    }
    const formData = new FormData();
    formData.append("_action", "updatePrivacySettings");
    formData.append("consentStrategy", pendingConsentStrategy);
    formData.append("dataRetentionDays", String(shop?.dataRetentionDays || 90));
    submit(formData, { method: "post" });
    setShowConsentModal(false);
    setPendingConsentStrategy(null);
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
                <br />• <strong>完整性校验密钥（HMAC）</strong>：用于完整性校验与基础抗滥用，不承诺强鉴权（密钥在客户端可见，最终真实性依赖 webhook/订单对账）
                <br />• <strong>速率限制</strong>：防止滥用和异常流量
                <br />• <strong>数据最小化</strong>：我们不收集、不处理、不发送终端客户 PII（包括哈希值）
              </Text>
              <Text as="p" variant="bodySm" tone="caution">
                <strong>安全边界说明：</strong>此令牌主要用于事件关联和诊断，配合上述多层防护机制共同保障安全。
                不要将此令牌视为强安全凭证，真正的安全由 webhook/订单对账与整体架构设计提供。
                <br />
                <strong>关于完整性校验密钥：</strong>ingestion_key 是完整性校验密钥，不是安全密钥。由于它通过 Web Pixel settings 下发到客户端，无法做到真正保密。
                此机制主要用于完整性校验与基础抗滥用，不承诺"强防伪造"。真正的安全由 webhook/订单对账与整体架构设计提供。
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
                    onClick={() => setShowRotateModal(true)}
                    loading={isSubmitting}
                  >
                    {shop?.hasIngestionSecret ? "更换令牌" : "生成令牌"}
                  </Button>
                </InlineStack>
              </Box>
              <Box
                background="bg-surface-secondary"
                padding="300"
                borderRadius="200"
              >
                <BlockStack gap="100">
                  <Text as="span" fontWeight="semibold">
                    事件接收校验模式
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={pixelStrictOrigin ? "success" : "warning"}>
                      {pixelStrictOrigin ? "严格" : "宽松"}
                    </Badge>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {pixelStrictOrigin ? "Origin 必须过白名单" : "非白名单/HMAC 失败仍可能被接收"}
                    </Text>
                  </InlineStack>
                  {!pixelStrictOrigin && (
                    <Text as="p" variant="bodySm" tone="caution">
                      来自非白名单来源或 HMAC 验证失败但未被拒绝的请求仍可能被接收并标为低信任，影响验收报告准确性。若需更高准确性，建议在部署环境设置 <code>PIXEL_STRICT_ORIGIN=true</code> 并配置好 Origin 白名单。
                    </Text>
                  )}
                </BlockStack>
              </Box>
              {shop?.hasActiveGraceWindow && shop.graceWindowExpiry && (
                <Banner tone="warning">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>旧令牌仍有效：</strong>之前的令牌将于{" "}
                      {new Date(shop.graceWindowExpiry).toLocaleString("zh-CN")}{" "}
                      失效。在此之前，新旧令牌均可使用，以便平滑过渡。
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      过渡期结束后，旧令牌将自动失效，系统将仅接受新令牌。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {shop?.hasExpiredPreviousSecret && (
                <Banner tone="info">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>旧令牌已过期：</strong>之前的令牌已自动清理，系统现在仅接受新令牌。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              {hmacSecurityStats && (
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">
                      完整性校验监控（过去24小时）
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      实时监控密钥轮换状态和可疑注入活动，确保系统安全。建议定期检查此面板，及时发现潜在安全风险。
                    </Text>
                    <Divider />
                    <BlockStack gap="300">
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              密钥轮换状态
                            </Text>
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() => setShowRotateModal(true)}
                              loading={isSubmitting}
                            >
                              立即轮换
                            </Button>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              上次轮换时间
                            </Text>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {hmacSecurityStats.lastRotationAt 
                                ? new Date(hmacSecurityStats.lastRotationAt).toLocaleString("zh-CN")
                                : "从未轮换"}
                            </Text>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              轮换次数
                            </Text>
                            <Badge tone={hmacSecurityStats.rotationCount > 0 ? "success" : "info"}>
                              {String(hmacSecurityStats.rotationCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.graceWindowActive && hmacSecurityStats.graceWindowExpiry && (
                            <Banner tone="info">
                              <Text as="p" variant="bodySm">
                                过渡期进行中：旧密钥将在 {new Date(hmacSecurityStats.graceWindowExpiry).toLocaleString("zh-CN")} 失效
                              </Text>
                            </Banner>
                          )}
                          {!hmacSecurityStats.lastRotationAt && (
                            <Banner tone="warning">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" fontWeight="semibold">
                                  建议：定期轮换密钥以提高安全性
                                </Text>
                                <Text as="p" variant="bodySm">
                                  系统检测到您尚未进行过密钥轮换。建议每90天轮换一次密钥，以降低密钥泄漏风险。点击"立即轮换"按钮开始轮换。
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  💡 密钥轮换后，系统会自动同步新密钥到 Web Pixel 配置，旧密钥将在30分钟内失效，确保平滑过渡。
                                </Text>
                                <Text as="p" variant="bodySm" tone="critical">
                                  ⚠️ <strong>重要提示：</strong>ingestion_key 是弱秘密，会下发到客户端运行环境，存在被提取的风险。轮换后请对比事件接收情况，如发现丢单风险，请检查 Web Pixel 配置是否已自动更新。如怀疑密钥泄露，应立即轮换并检查事件日志。
                                </Text>
                              </BlockStack>
                            </Banner>
                          )}
                          {hmacSecurityStats.lastRotationAt && (() => {
                            const daysSinceRotation = Math.floor((Date.now() - new Date(hmacSecurityStats.lastRotationAt).getTime()) / (1000 * 60 * 60 * 24));
                            if (daysSinceRotation >= 90) {
                              return (
                                <Banner tone="warning">
                                  <BlockStack gap="200">
                                    <Text as="p" variant="bodySm" fontWeight="semibold">
                                      建议：密钥已超过90天未轮换
                                    </Text>
                                    <Text as="p" variant="bodySm">
                                      上次轮换时间：{new Date(hmacSecurityStats.lastRotationAt).toLocaleString("zh-CN")}（{daysSinceRotation} 天前）。建议定期轮换密钥以降低安全风险。点击"立即轮换"按钮开始轮换。
                                    </Text>
                                    <Text as="p" variant="bodySm" tone="critical">
                                      ⚠️ <strong>重要提示：</strong>ingestion_key 是弱秘密，会下发到客户端运行环境，存在被提取的风险。轮换后请对比事件接收情况，如发现丢单风险，请检查 Web Pixel 配置是否已自动更新。如怀疑密钥泄露，应立即轮换并检查事件日志。
                                    </Text>
                                  </BlockStack>
                                </Banner>
                              );
                            }
                            return null;
                          })()}
                        </BlockStack>
                      </Box>
                      <Divider />
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                        <BlockStack gap="300">
                          <Text as="p" variant="bodySm" fontWeight="semibold">
                            可疑注入告警
                          </Text>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              无效签名次数
                            </Text>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={hmacSecurityStats.invalidSignatureCount > 0 ? "critical" : "success"}>
                                {String(hmacSecurityStats.invalidSignatureCount)}
                              </Badge>
                              {hmacSecurityStats.invalidSignatureCount > 0 && hmacSecurityStats.lastInvalidSignature && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  (最近: {new Date(hmacSecurityStats.lastInvalidSignature).toLocaleString("zh-CN")})
                                </Text>
                              )}
                            </InlineStack>
                          </InlineStack>
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm">
                              Null Origin 请求数
                            </Text>
                            <Badge tone={hmacSecurityStats.nullOriginRequestCount > 10 ? "warning" : "success"}>
                              {String(hmacSecurityStats.nullOriginRequestCount)}
                            </Badge>
                          </InlineStack>
                          <Divider />
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              可疑活动总数
                            </Text>
                            <Badge tone={hmacSecurityStats.suspiciousActivityCount > 10 ? "critical" : hmacSecurityStats.suspiciousActivityCount > 0 ? "warning" : "success"}>
                              {String(hmacSecurityStats.suspiciousActivityCount)}
                            </Badge>
                          </InlineStack>
                          {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.lastSuspiciousActivity && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              最近可疑活动: {new Date(hmacSecurityStats.lastSuspiciousActivity).toLocaleString("zh-CN")}
                            </Text>
                          )}
                        </BlockStack>
                      </Box>
                      {hmacSecurityStats.suspiciousActivityCount > 10 && (
                        <Banner tone="critical">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              ⚠️ 检测到大量可疑活动 - 建议立即采取行动
                            </Text>
                            <Text as="p" variant="bodySm">
                              系统检测到 {hmacSecurityStats.suspiciousActivityCount} 次可疑活动，可能包括无效签名或异常来源请求。这可能是密钥泄漏或注入攻击的迹象。
                            </Text>
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              立即执行的操作：
                            </Text>
                            <List type="bullet">
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  立即轮换密钥（点击上方"立即轮换"按钮或"更换令牌"按钮）
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  检查访问日志和事件接收记录，审查异常请求来源
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  如果怀疑密钥泄漏，立即更换令牌并检查事件日志
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  审查是否有异常来源的请求或注入尝试
                                </Text>
                              </List.Item>
                              <List.Item>
                                <Text as="span" variant="bodySm">
                                  检查监控页面的"事件丢失率"指标，确认是否有异常事件丢失
                                </Text>
                              </List.Item>
                            </List>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount > 0 && hmacSecurityStats.suspiciousActivityCount <= 10 && (
                        <Banner tone="warning">
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              ⚠️ 检测到可疑活动
                            </Text>
                            <Text as="p" variant="bodySm">
                              系统检测到 {hmacSecurityStats.suspiciousActivityCount} 次可疑活动。建议定期检查访问日志，如果活动持续增加，请考虑轮换密钥。
                            </Text>
                            <Text as="p" variant="bodySm">
                              如果无效签名次数持续增加，可能是密钥泄漏的早期迹象。建议在下次维护窗口时轮换密钥。
                            </Text>
                          </BlockStack>
                        </Banner>
                      )}
                      {hmacSecurityStats.suspiciousActivityCount === 0 && (
                        <Banner tone="success">
                          <Text as="p" variant="bodySm">
                            ✅ 过去24小时内未检测到可疑活动，系统运行正常
                          </Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>
              )}
              {!shop?.hasIngestionSecret && (
                <Banner tone="critical">
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" fontWeight="semibold">
                      <strong>⚠️ 未配置关联令牌：</strong>请立即生成令牌以确保像素事件完整性校验可用
                    </Text>
                    <Text as="p" variant="bodySm">
                      未配置令牌时，像素事件仍可接收，但完整性信号与关联能力会下降。请点击上方"生成令牌"按钮创建新令牌。
                    </Text>
                  </BlockStack>
                </Banner>
              )}
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ P0 安全提示：PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY 配置与 ingestionKey 管理
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>生产环境必须显式设置：</strong>
                    <br />• <code>PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY</code> 环境变量（允许：<code>true</code>/<code>false</code> 或 <code>1</code>/<code>0</code>）
                    <br />• 某些 Shopify Web Worker 沙箱环境可能出现 <code>Origin: null</code>；若需要接收此类事件，建议设置为 <code>true</code>
                    <br />• 若设置为 <code>false</code>，<code>Origin: null</code> 的请求将被拒绝，可能导致事件丢失
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>ingestionKey 可见性风险：</strong>
                    <br />• ingestion_key 会下发到像素客户端，属于公开信号，不能作为强鉴权凭证
                    <br />• null origin 请求无法依赖 Origin 验证，HMAC 只能作为完整性信号与抗噪手段
                    <br />• 真实订单与转化真实性应以 Shopify webhook/订单对账为准
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>必须执行的措施：</strong>
                    <br />• <strong>定期轮换 ingestionKey</strong>（建议每 90 天，使用上方"更换令牌"按钮）
                    <br />• <strong>监控异常事件接收模式</strong>（在 Dashboard 中查看事件统计，特别关注 null origin 请求）
                    <br />• null origin 请求量异常飙升时会在日志中记录 <code>[SECURITY] Null origin request spike</code>，请关注监控与日志
                    <br />• <strong>如果怀疑滥用，立即更换令牌</strong>并检查事件日志，审查访问记录
                    <br />• <code>PIXEL_ALLOW_NULL_ORIGIN_WITH_SIGNATURE_ONLY</code> 为可选开关：默认允许带签名的 Origin:null/missing 请求；设置为 <code>false</code> 时将拒绝该类请求
                    <br />• <strong>使用令牌轮换机制</strong>（更换后旧令牌有 30 分钟过渡期，确保平滑过渡）
                    <br />• <strong>记录并审计令牌轮换操作</strong>，建立运维手册和操作流程
                    <br />• <strong>建立令牌过期机制</strong>（系统已支持 previousIngestionSecret 和 previousSecretExpiry，建议定期轮换）
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>令牌轮换机制说明：</strong>更换令牌时，系统会自动保存旧令牌为 previousIngestionSecret，并在 30 分钟内同时接受新旧令牌，确保 Web Pixel 配置更新期间不会丢失事件。过渡期结束后，旧令牌自动失效。如果发现滥用，应立即轮换令牌，系统会自动同步新令牌到 Web Pixel 配置。轮换后，请检查事件接收日志，确认新令牌正常工作。
                  </Text>
                </BlockStack>
              </Banner>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    工作原理：
                  </Text>
                  <Text as="p" variant="bodySm">
                    服务端会记录此令牌并将其作为完整性信号，缺少或错误的令牌不会阻断接收，但会降低事件信任度。
                    更换令牌后，App Pixel 会自动更新，旧令牌会有 30 分钟的过渡期（grace window）。
                  </Text>
                  <Text as="p" variant="bodySm">
                    <strong>令牌轮换机制：</strong>
                    <br />• 更换令牌时，旧令牌会保存为 previousIngestionSecret
                    <br />• 旧令牌在 30 分钟内仍可使用，确保平滑过渡
                    <br />• 过渡期结束后，旧令牌自动失效
                    <br />• 系统会自动同步新令牌到 Web Pixel 配置
                  </Text>
                </BlockStack>
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
                    <br />
                    我们不存储客户 PII（姓名/邮箱/电话/地址），仅在必要时存不可逆
                    hash 作为像素事件去重或诊断信号；当前公开上架版本不会从
                    Shopify 读取订单明细，也不会访问 Protected Customer Data (PCD)。当前不申请 read_orders、不订阅订单 webhook。
                    未来如引入基于订单的验收/对账或再购等功能，将在获得 PCD 审批
                    后单独启用，并更新隐私与合规文档。
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
                    <strong>策略说明（按平台/用途配置）：</strong>当前 manifest 配置需要 analytics 或 marketing 同意才能加载像素（<code>analytics = true, marketing = true</code>）。这意味着当客户授予 analytics 或 marketing 同意时，Pixel 就会加载；如果客户未授予任一同意，Pixel 不会加载。事件发送需要客户授予 analytics 或 marketing 同意（代码中检查 <code>hasAnalyticsConsent() || hasMarketingConsent()</code>）。后端会根据各平台的实际用途进一步过滤事件：GA4（分析类，使用 analytics consent）和 Meta/TikTok（营销类，需要 marketing consent，如果客户只授予了 analytics 同意，这些平台的事件将被服务端过滤），确保合规性。
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
                控制事件在验收与内部处理链路中的过滤策略。不同策略适用于不同地区的合规要求。
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
                      当前版本仅接收与校验 Web Pixel 事件，不提供服务端投递能力。
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
      <Modal
        open={showConsentModal}
        onClose={() => {
          setShowConsentModal(false);
          setPendingConsentStrategy(null);
        }}
        title="确认切换隐私策略"
        primaryAction={{
          content: "确认切换",
          onAction: confirmConsentStrategyChange,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => {
              setShowConsentModal(false);
              setPendingConsentStrategy(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              平衡模式仍要求像素回执与明确同意，但允许"部分可信"的回执（trust=partial）。
            </Text>
            <Text as="p" tone="subdued">
              在 GDPR 等严格隐私法规地区，推荐使用严格模式。确定要切换吗？
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showRotateModal}
        onClose={() => setShowRotateModal(false)}
        title={shop?.hasIngestionSecret ? "确认更换关联令牌" : "确认生成关联令牌"}
        primaryAction={{
          content: shop?.hasIngestionSecret ? "确认更换" : "确认生成",
          destructive: true,
          onAction: () => {
            setShowRotateModal(false);
            onRotateSecret();
          },
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowRotateModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              {shop?.hasIngestionSecret
                ? "更换后 Web Pixel 将自动更新，请确保已通知相关成员。"
                : "生成后将自动配置至 Web Pixel。"}
            </Text>
            {shop?.hasIngestionSecret && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    ⚠️ 轮换后风险提示
                  </Text>
                  <Text as="p" variant="bodySm">
                    ingestion_key 是弱秘密，会下发到客户端运行环境。轮换后请：
                    <br />• 对比事件接收情况，检查是否有丢单风险
                    <br />• 确认 Web Pixel 配置已自动更新
                    <br />• 如怀疑密钥泄露，应立即轮换并检查事件日志
                    <br />• 旧密钥将在30分钟内失效，确保平滑过渡
                  </Text>
                </BlockStack>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Layout>
  );
}
