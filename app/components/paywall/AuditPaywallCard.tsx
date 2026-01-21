import { Banner, BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";
import { getPlanOrDefault } from "~/services/billing/plans";
import { isPlanAtLeast, normalizePlan } from "~/utils/plans";

interface AuditPaywallCardProps {
  planId: string | null | undefined;
}

const priceLabel = (price: number) => `$${price}/月`;

export function AuditPaywallCard({ planId }: AuditPaywallCardProps) {
  const planIdSafe = normalizePlan(planId);
  const isStarter = isPlanAtLeast(planIdSafe, "starter");
  const isGrowth = isPlanAtLeast(planIdSafe, "growth");
  const isAgency = isPlanAtLeast(planIdSafe, "agency");
  const starterPlan = getPlanOrDefault("starter");
  const growthPlan = getPlanOrDefault("growth");
  const agencyPlan = getPlanOrDefault("agency");
  const migrationLabel = isStarter
    ? "迁移像素"
    : `迁移像素（${starterPlan.name} ${priceLabel(starterPlan.price)}）`;
  const moduleLabel = isStarter
    ? "安装页面模块"
    : `安装页面模块（${starterPlan.name} ${priceLabel(starterPlan.price)}）`;
  const bannerLines = (() => {
    if (!isStarter) {
      return [
        {
          label: "免费功能：",
          text: "可查看风险与清单、分享链接",
        },
        {
          label: "付费解锁：",
          text: `一键生成像素 + Test/Live 环境 + 版本/回滚 + 验收报告导出（${starterPlan.name} ${priceLabel(starterPlan.price)} 起）`,
        },
      ];
    }
    if (!isGrowth) {
      return [
        {
          label: "已解锁：",
          text: `${starterPlan.name} 像素迁移 + Test/Live 环境 + 版本/回滚`,
        },
        {
          label: "升级解锁：",
          text: `${growthPlan.name} 验收报告导出 + 事件对账 + 告警`,
        },
      ];
    }
    if (!isAgency) {
      return [
        {
          label: "已解锁：",
          text: `${growthPlan.name} 验收报告导出 + 事件对账 + 告警`,
        },
        {
          label: "升级解锁：",
          text: `多店/白标/批量即将在 v1.1 推出；${agencyPlan.name} 当前已含无限像素、全部模块、验收报告导出与 SLA`,
        },
      ];
    }
    return [
      {
        label: "已解锁：",
        text: `多店/白标/批量即将在 v1.1 推出；当前已含无限像素、全部模块、验收报告导出与 SLA`,
      },
      {
        label: "需要协助：",
        text: "如需迁移托管或定制支持，请联系客户成功经理",
      },
    ];
  })();
  const upgradeTarget = !isStarter
    ? "starter"
    : !isGrowth
      ? "growth"
      : !isAgency
        ? "agency"
        : null;
  const upgradePlan = upgradeTarget ? getPlanOrDefault(upgradeTarget) : null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          🎯 开始迁移（PRD 3: 付费转化节点1）
        </Text>
        <Banner tone="info">
          <BlockStack gap="200">
            {bannerLines.map((line) => (
              <Text key={line.label} as="p" variant="bodySm">
                <strong>{line.label}</strong>{" "}
                {line.text}
              </Text>
            ))}
          </BlockStack>
        </Banner>
        <InlineStack gap="200" wrap>
          <Button
            variant={isStarter ? "primary" : "secondary"}
            url={isStarter ? "/app/migrate" : "/app/billing?upgrade=starter"}
            size="large"
          >
            {migrationLabel}
          </Button>
          <Button
            variant={isStarter ? "primary" : "secondary"}
            url={isStarter ? "/app/modules" : "/app/billing?upgrade=starter"}
            size="large"
          >
            {moduleLabel}
          </Button>
          {upgradePlan && isStarter && (
            <Button
              variant="secondary"
              url={`/app/billing?upgrade=${upgradePlan.id}`}
              size="large"
            >
              {`升级到 ${upgradePlan.name} ${priceLabel(upgradePlan.price)}`}
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
