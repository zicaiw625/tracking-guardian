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
import { BILLING_PLANS, type PlanId } from "~/services/billing/plans";
import { isPlanAtLeast, getPlanDefinition } from "~/utils/plans";
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
    description: "标准事件映射 + 参数完整率（v1 最小可用迁移）",
    requiredPlan: "starter",
    featureList: [
      "支持 GA4、Meta、TikTok（v1 仅此 3 个平台，避开 Elevar/Littledata 高价位竞争）",
      "标准事件映射：自动映射标准电商事件（purchase、view_item、add_to_cart 等）",
      "参数完整率检查：验证事件参数（value、currency、items 等）的完整性",
      "可下载 payload 证据：支持下载事件 payload，用于验证和存档",
      "Test/Live 环境切换：支持测试环境验证后再发布到生产环境",
      "技术说明：Web Pixel 运行在严格沙箱（Web Worker）环境中，很多能力受限",
    ],
  },
  ui_modules: {
    name: "UI 模块",
    description: "Thank you / Order status 页面模块（v1 仅支持 Survey/Helpdesk）",
    requiredPlan: "starter",
    featureList: [
      "Post-purchase Survey（购后问卷）",
      "Help & Support 模块（帮助中心/联系客服）",
      "基于 Checkout UI Extensions 的合规实现",
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
            需要套餐：<strong>{requiredPlan.name}</strong>（{requiredPlan.priceLabel}/月）
          </Text>
        </BlockStack>

        <Button variant="primary" onClick={handleUpgrade} fullWidth>
          升级到 {requiredPlan.name}
        </Button>
      </BlockStack>
    </Card>
  );
}
