import { Card, Text, BlockStack, InlineStack, Badge, Box, Banner, Divider, Icon, RangeSlider, Button } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ArrowRightIcon } from "~/components/icons";
import { getPlatformName } from "~/components/scan/utils";
import { calculateROIEstimate } from "~/utils/scan-format";

interface MigrationImpactAnalysisProps {
  latestScan: {
    riskScore: number;
  };
  identifiedPlatforms: string[];
  scriptTags: Array<{ id: number }>;
  monthlyOrders: number;
  onMonthlyOrdersChange: (value: number) => void;
}

export function MigrationImpactAnalysis({
  latestScan,
  identifiedPlatforms,
  scriptTags,
  monthlyOrders,
  onMonthlyOrdersChange,
}: MigrationImpactAnalysisProps) {
  const roiEstimate = calculateROIEstimate(monthlyOrders, identifiedPlatforms.length, scriptTags.length);

  if (latestScan.riskScore === 0) {
    return null;
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            📊 迁移影响分析（仅供参考）
          </Text>
          <Badge tone="info">示例估算</Badge>
        </InlineStack>
        <Banner tone="warning">
          <Text as="p" variant="bodySm">
            <strong>⚠️ 免责声明：</strong>以下为简化示意，仅帮助理解迁移的必要性。
            实际业务影响因店铺业务模式、流量来源、客户群体、广告账户设置等多种因素而异，
            本工具无法预测具体数值影响，不构成任何效果保证或承诺。
          </Text>
        </Banner>
        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <Text as="p" fontWeight="semibold">
              🧮 输入您的月订单量，查看具体影响
            </Text>
            <RangeSlider
              label="月订单量"
              value={monthlyOrders}
              onChange={(value) => onMonthlyOrdersChange(value as number)}
              output
              min={100}
              max={10000}
              step={100}
              suffix={<Text as="span" variant="bodySm">{monthlyOrders} 单/月</Text>}
            />
          </BlockStack>
        </Box>
        <Box background="bg-fill-critical-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={AlertCircleIcon} tone="critical" />
              <Text as="h3" variant="headingMd" tone="critical">
                不迁移会丢失什么？（示意说明）
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">可能受影响的事件</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    {roiEstimate.platforms} 平台 × {monthlyOrders} 订单
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">受影响 ScriptTag</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                    {roiEstimate.scriptTagCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="critical">
                    将在截止日停止执行
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">实际影响</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                    因店铺而异
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    取决于流量来源和客户群体
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              {identifiedPlatforms.length > 0 ? (
                identifiedPlatforms.map((platform) => (
                  <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200">
                        <Badge tone="critical">将失效</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="critical">
                        参考值（仅供估算）
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  当前 ScriptTag 中的追踪代码将在截止日期后全部失效
                </Text>
              )}
            </BlockStack>
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                <strong>⚠️ 重要提醒：</strong>
                ScriptTag 在截止日期后将停止执行，导致其中的追踪代码失效。
                实际对您业务的影响取决于流量来源、客户群体、广告策略等多种因素，
                本工具无法预测具体金额影响。建议您结合自身业务情况评估迁移优先级。
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                <strong>日期来源说明：</strong>截止日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
              </Text>
            </Banner>
          </BlockStack>
        </Box>
        <Divider />
        <Box background="bg-fill-success-secondary" padding="400" borderRadius="200">
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="h3" variant="headingMd" tone="success">
                迁移后能恢复什么？（您的预期收益）
              </Text>
            </InlineStack>
            <InlineStack gap="400" align="space-between" wrap>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">每月恢复事件</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    {roiEstimate.eventsLostPerMonth.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    转化追踪功能恢复
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">潜在收益（示例）</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    确保追踪
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    避免数据中断
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface" padding="300" borderRadius="100" minWidth="150px">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Web Pixel</Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    标准事件
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    合规迁移（v1）
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
            <BlockStack gap="200">
              {identifiedPlatforms.length > 0 ? (
                identifiedPlatforms.map((platform) => (
                  <Box key={platform} background="bg-surface" padding="300" borderRadius="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200">
                        <Badge tone="success">✓ 恢复</Badge>
                        <Text as="span" fontWeight="semibold">{getPlatformName(platform)}</Text>
                      </InlineStack>
                      <Text as="span" variant="bodySm" tone="success">
                        每月 {monthlyOrders.toLocaleString()} 个转化事件 → 广告平台
                      </Text>
                    </InlineStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodySm">
                  所有追踪功能将通过 Web Pixel 标准事件映射恢复（v1 最小可用迁移）
                </Text>
              )}
            </BlockStack>
            <Banner tone="success">
              <Text as="p" variant="bodySm">
                <strong>✅ 迁移的核心价值：</strong>
                迁移是一次性工作，完成后可确保转化追踪在 ScriptTag 废弃后继续正常工作。
                v1 提供 Web Pixel 标准事件映射（GA4/Meta/TikTok）。
                实际追踪效果因店铺情况而异。
              </Text>
            </Banner>
          </BlockStack>
        </Box>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            迁移前后对比
          </Text>
          <InlineStack gap="400" align="space-between" wrap={false}>
            <Box background="bg-surface-critical" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">当前（不迁移）</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                  {latestScan.riskScore > 60 ? "高风险" : latestScan.riskScore > 30 ? "中风险" : "低风险"}
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  {scriptTags.length} 个 ScriptTag 将失效
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">迁移后</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  功能恢复
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  Web Pixel 标准事件
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box background="bg-surface-success" padding="300" borderRadius="200" minWidth="200px">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">额外收益</Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  更稳定
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  不受隐私限制影响
                </Text>
              </BlockStack>
            </Box>
          </InlineStack>
          <Banner tone="info" title="v1 最小可用迁移说明">
            <Text as="p" variant="bodySm">
              ✅ v1 支持：Web Pixel 标准事件映射（GA4/Meta/TikTok）
              <br />
              ✅ 标准事件映射 + 参数完整率检查 + 可下载 payload 证据
              <br />
              ✅ 验收向导 + 事件参数完整率 + 订单金额/币种一致性验证
              <br />
              <Text as="span" tone="subdued">
                注：实际归因效果因广告账户设置、流量来源等因素而异
              </Text>
            </Text>
          </Banner>
        </BlockStack>
        <InlineStack align="end" gap="200">
          <Button url="/app/migrate" variant="primary">
            立即开始迁移
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
