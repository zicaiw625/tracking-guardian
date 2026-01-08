import { Banner, Button, BlockStack, InlineStack, Text } from "@shopify/polaris";
import { LockIcon } from "~/components/icons";
import type { PlanId } from "~/services/billing/plans";
import { getPlanDefinition } from "~/utils/plans";

interface PaidFeaturePromptProps {
  feature: "pixel_migration" | "batch_audit" | "export_report" | "verification";
  currentPlan: PlanId;
  compact?: boolean;
}

const FEATURE_INFO: Record<
  PaidFeaturePromptProps["feature"],
  {
    name: string;
    description: string;
    requiredPlan: PlanId;
    cta: string;
  }
> = {
  pixel_migration: {
    name: "一键像素迁移",
    description: "自动生成和配置像素追踪，无需手动编写代码",
    requiredPlan: "starter",
    cta: "升级到 Starter 开始迁移",
  },
  batch_audit: {
    name: "批量 Audit 扫描",
    description: "同时扫描多个店铺，生成统一报告",
    requiredPlan: "agency",
    cta: "升级到 Agency 解锁批量功能",
  },
  export_report: {
    name: "报告导出",
    description: "导出 PDF/CSV 格式的迁移报告",
    requiredPlan: "agency",
    cta: "升级到 Agency 解锁导出功能",
  },
  verification: {
    name: "验收测试",
    description: "验证迁移配置是否正确工作",
    requiredPlan: "starter",
    cta: "升级到 Starter 解锁验收功能",
  },
};

export function PaidFeaturePrompt({
  feature,
  currentPlan,
  compact = false,
}: PaidFeaturePromptProps) {
  const info = FEATURE_INFO[feature];
  const requiredPlan = getPlanDefinition(info.requiredPlan);
  const currentPlanDef = getPlanDefinition(currentPlan);

  const handleUpgrade = () => {
    window.location.href = "/app/billing";
  };

  if (compact) {
    return (
      <Banner tone="info">
        <InlineStack gap="300" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodySm">
            {info.name}需要 {requiredPlan.name} 及以上套餐
          </Text>
          <Button size="slim" variant="plain" onClick={handleUpgrade}>
            {info.cta}
          </Button>
        </InlineStack>
      </Banner>
    );
  }

  return (
    <Banner tone="info">
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center">
          <LockIcon />
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {info.name}
          </Text>
        </InlineStack>
        <Text as="p" variant="bodySm">
          {info.description}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          当前套餐：<strong>{currentPlanDef.name}</strong> → 需要：<strong>{requiredPlan.name}</strong>
        </Text>
        <Button variant="primary" size="medium" onClick={handleUpgrade}>
          {info.cta}
        </Button>
      </BlockStack>
    </Banner>
  );
}
