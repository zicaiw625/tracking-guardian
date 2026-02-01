import {
  InlineStack,
  Text,
  Badge,
  Button,
  Popover,
  ActionList,
  Box,
} from "@shopify/polaris";
import { useState } from "react";
import { QuestionCircleIcon } from "~/components/icons";
import { SHOPIFY_HELP_LINKS } from "~/utils/migration-deadlines";
import { getPlanConfig, type PlanId } from "~/services/billing/plans";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

interface TopBarProps {
  shopDomain: string;
  planId: PlanId;
  planDisplayName: string;
  currentShopId?: string;
}

export function TopBar({
  shopDomain,
  planId,
  planDisplayName: _planDisplayName,
  currentShopId: _currentShopId,
}: TopBarProps) {
  const { t } = useTranslation();
  const [popoverActive, setPopoverActive] = useState(false);
  const planConfig = getPlanConfig(planId);
  const planBadgeTone =
    planId === "free"
      ? "info"
      : planId === "starter"
        ? "attention"
        : planId === "growth"
          ? "success"
          : "new";
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
          <LanguageSwitcher />
          <Popover
            active={popoverActive}
            activator={
              <Button size="slim" variant="plain" icon={QuestionCircleIcon} onClick={() => setPopoverActive(!popoverActive)}>
                {t("topbar.help")}
              </Button>
            }
            onClose={() => setPopoverActive(false)}
          >
            <ActionList
              items={[
                {
                  content: t("topbar.documentation"),
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
