import {
  InlineStack,
  Text,
  Badge,
  Button,
  Popover,
  ActionList,
} from "@shopify/polaris";
import { QuestionCircleIcon } from "~/components/icons";
import { SHOPIFY_HELP_LINKS } from "~/utils/migration-deadlines";
import { getPlanConfig, type PlanId } from "~/services/billing/plans";

interface TopBarProps {
  shopDomain: string;
  planId: PlanId;
  planDisplayName: string;
  currentShopId?: string;
}

export function TopBar({
  shopDomain,
  planId,
  planDisplayName,
  currentShopId,
}: TopBarProps) {
  const planConfig = getPlanConfig(planId);
  const planBadgeTone =
    planId === "free"
      ? "info"
      : planId === "starter"
        ? "attention"
        : planId === "growth"
          ? "success"
          : "new";

  const handleUpgradeClick = useCallback(() => {
    void fetch("/api/analytics-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "app_upgrade_clicked",
        metadata: {
          plan: planId,
          triggerPage: "top_bar",
        },
      }),
    });
  }, [planId]);


  return (
    <Box
      background="bg-surface"
      paddingBlock="300"
      paddingInline="400"
      borderBlockEndWidth="025"
      borderColor="border"
    >
      <InlineStack align="space-between" blockAlign="center" gap="400">
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {shopDomain}
        </Text>

        <InlineStack gap="300" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Badge tone={planBadgeTone}>{planConfig.name}</Badge>
          </InlineStack>

          <Popover
            activator={
              <Button size="slim" variant="plain" icon={QuestionCircleIcon}>
                帮助
              </Button>
            }
          >
            <ActionList
              items={[
                {
                  content: "文档",
                  external: true,
                  url: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE,
                },
              ]}
            />
          </Popover>
        </InlineStack>
      </InlineStack>
    </Box>
  );
}
