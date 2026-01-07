import { useMemo } from "react";
import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Banner,
  Divider,
  RangeSlider,
  Button,
  Icon,
} from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon, ArrowRightIcon } from "~/components/icons";
import type { ScriptTag } from "../../types";
import { getPlatformName } from "./utils";

interface ROIEstimatorProps {
  riskScore: number;
  scriptTags: ScriptTag[];
  identifiedPlatforms: string[];
  monthlyOrders: number;
  onMonthlyOrdersChange: (value: number) => void;
}

export function ROIEstimator({
  riskScore,
  scriptTags,
  identifiedPlatforms,
  monthlyOrders,
  onMonthlyOrdersChange,
}: ROIEstimatorProps) {
  const roiEstimate = useMemo(() => {
    const platforms = identifiedPlatforms.length || 1;
    const scriptTagCount = scriptTags.length;
    const eventsLostPerMonth = monthlyOrders * platforms;
    const hasRisk = scriptTagCount > 0;
    return {
      eventsLostPerMonth,
      hasRisk,
      platforms,
      scriptTagCount,
    };
  }, [monthlyOrders, identifiedPlatforms, scriptTags]);
  if (riskScore === 0) return null;
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
              suffix={
                <Text as="span" variant="bodySm">
                  {monthlyOrders} 单/月
                </Text>
              }
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    可能受影响的事件
                  </Text>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    受影响 ScriptTag
                  </Text>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    实际影响
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="caution">
                    因店铺而异
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    取决于流量来源和客户群体
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    每月恢复事件
                  </Text>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    潜在收益（示例）
                  </Text>
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    服务端追踪
                  </Text>
                  <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                    更可靠
                  </Text>
                  <Text as="p" variant="bodySm" tone="success">
                    CAPI 双重保障
                  </Text>
                </BlockStack>
              </Box>
            </InlineStack>
          </BlockStack>
        </Box>
        <Divider />
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            迁移前后对比
          </Text>
          <InlineStack gap="400" align="space-between" wrap={false}>
            <Box
              background="bg-surface-critical"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  当前（不迁移）
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                  {riskScore > 60 ? "高风险" : riskScore > 30 ? "中风险" : "低风险"}
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  {scriptTags.length} 个 ScriptTag 将失效
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box
              background="bg-surface-success"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  迁移后
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  功能恢复
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  Web Pixel + CAPI 双保险
                </Text>
              </BlockStack>
            </Box>
            <Box padding="300">
              <Icon source={ArrowRightIcon} tone="subdued" />
            </Box>
            <Box
              background="bg-surface-success"
              padding="300"
              borderRadius="200"
              minWidth="200px"
            >
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">
                  额外收益
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold" tone="success">
                  更稳定
                </Text>
                <Text as="p" variant="bodySm" tone="success">
                  不受隐私限制影响
                </Text>
              </BlockStack>
            </Box>
          </InlineStack>
          <Banner tone="info" title="服务端 CAPI 的技术优势">
            <Text as="p" variant="bodySm">
              ✅ 不受 iOS 14.5+ App Tracking Transparency 限制
              <br />
              ✅ 不受浏览器广告拦截器影响
              <br />
              ✅ 不受第三方 Cookie 弃用影响
              <br />
              ✅ Shopify Webhook 直接传递订单数据
              <br />
              <Text as="span" tone="subdued">
                注：实际归因效果因广告账户设置、流量来源等因素而异
              </Text>
            </Text>
          </Banner>
        </BlockStack>
        <InlineStack align="end" gap="200">
          <Button url="/app/diagnostics">查看追踪诊断</Button>
          <Button url="/app/migrate" variant="primary">
            立即开始迁移
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
