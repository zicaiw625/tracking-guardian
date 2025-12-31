
import {
  Banner,
  Button,
  BlockStack,
  InlineStack,
  Text,
  List,
  Card,
} from "@shopify/polaris";
import { LockIcon } from "~/components/icons";
import { BILLING_PLANS, type PlanId, getPlanDefinition } from "~/services/billing/plans";
import { isPlanAtLeast } from "~/utils/plans";
import type { FeatureGateResult } from "~/services/billing/feature-gates.server";

export interface UpgradePromptProps {
  feature: "pixel_destinations" | "ui_modules" | "verification" | "alerts" | "reconciliation" | "agency";
  currentPlan: PlanId;
  gateResult?: FeatureGateResult;
  current?: number;
  limit?: number;
  onUpgrade?: () => void;
  tone?: "info" | "warning" | "critical";
  compact?: boolean;
}

const FEATURE_INFO: Record<
  UpgradePromptProps["feature"],
  {
    name: string;
    description: string;
    requiredPlan: PlanId;
    featureList?: string[];
  }
> = {
  pixel_destinations: {
    name: "像素目的地",
    description: "配置多个广告平台的像素追踪",
    requiredPlan: "starter",
    featureList: [
      "支持 GA4、Meta、TikTok、Pinterest 等平台",
      "服务端 Conversions API 发送",
      "事件去重与一致性保障",
    ],
  },
  ui_modules: {
    name: "UI 模块",
    description: "在 Thank you / Order status 页面添加自定义模块",
    requiredPlan: "starter",
    featureList: [
      "购后问卷、订单追踪、再购按钮",
      "帮助中心、追加销售等模块",
      "完全自定义配置",
    ],
  },
  verification: {
    name: "验收功能",
    description: "验证迁移配置是否正确工作",
    requiredPlan: "starter",
    featureList: [
      "测试订单生成与验证",
      "事件参数完整性检查",
      "金额准确性验证",
    ],
  },
  alerts: {
    name: "告警功能",
    description: "实时监控追踪健康状态",
    requiredPlan: "growth",
    featureList: [
      "多渠道告警（邮件/Slack/Telegram）",
      "事件失败率监控",
      "自动异常检测",
    ],
  },
  reconciliation: {
    name: "事件对账",
    description: "对比 Shopify 订单与平台转化数据",
    requiredPlan: "growth",
    featureList: [
      "每日自动对账",
      "偏差率分析",
      "送达缺口定位",
    ],
  },
  agency: {
    name: "Agency 多店功能",
    description: "管理多个店铺的批量操作",
    requiredPlan: "agency",
    featureList: [
      "多店工作区管理",
      "批量 Audit 扫描",
      "批量应用像素模板",
      "迁移验收报告导出",
    ],
  },
};

export function UpgradePrompt({
  feature,
  currentPlan,
  gateResult,
  current,
  limit,
  onUpgrade,
  tone = "info",
  compact = false,
}: UpgradePromptProps) {
  const info = FEATURE_INFO[feature];
  const requiredPlan = getPlanDefinition(info.requiredPlan);
  const currentPlanDef = getPlanDefinition(currentPlan);
  const isUpgradeNeeded = currentPlan !== "free" && !isPlanAtLeast(currentPlan, info.requiredPlan);

  const needsUpgrade = isUpgradeNeeded || (gateResult && !gateResult.allowed);

  if (!needsUpgrade && !gateResult) {
    return null;
  }

  const showLimitInfo = limit !== undefined && current !== undefined && current >= limit;

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      window.location.href = "/app/billing";
    }
  };

  if (compact) {
    return (
      <Banner tone={tone}>
        <InlineStack gap="300" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodySm">
            {gateResult?.reason || `${info.name}需要 ${requiredPlan.name} 及以上套餐`}
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            升级套餐
          </Button>
        </InlineStack>
      </Banner>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          <LockIcon />
          <Text as="h3" variant="headingMd">
            {info.name}需要升级套餐
          </Text>
        </InlineStack>

        <Text as="p" tone="subdued">
          {info.description}
        </Text>

        {showLimitInfo && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              当前已使用 {current} / {limit} 个{info.name}。
              {limit === 0 && "当前套餐不支持此功能。"}
            </Text>
          </Banner>
        )}

        {gateResult?.reason && (
          <Banner tone={tone}>
            <Text as="p" variant="bodySm">
              {gateResult.reason}
            </Text>
          </Banner>
        )}

        {info.featureList && (
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {requiredPlan.name} 套餐包含：
            </Text>
            <List type="bullet">
              {info.featureList.map((item, index) => (
                <List.Item key={index}>{item}</List.Item>
              ))}
            </List>
          </BlockStack>
        )}

        <BlockStack gap="200">
          <Text as="p" variant="bodySm" tone="subdued">
            当前套餐：<strong>{currentPlanDef.name}</strong>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            需要套餐：<strong>{requiredPlan.name}</strong>（${requiredPlan.price}/月）
          </Text>
        </BlockStack>

        <Button variant="primary" onClick={handleUpgrade} fullWidth>
          升级到 {requiredPlan.name}
        </Button>
      </BlockStack>
    </Card>
  );
}

