import { Card, BlockStack, Box, InlineStack, Text, Badge, Button, Icon } from "@shopify/polaris";
import { AlertCircleIcon, ArrowRightIcon } from "~/components/icons";
import type { RiskItem } from "../../types";
import { getSeverityBadge, getPlatformName } from "./utils";
import { useTranslation } from "react-i18next";

interface RiskDetailsProps {
  riskItems: RiskItem[];
}

export function RiskDetails({ riskItems }: RiskDetailsProps) {
  const { t } = useTranslation();

  if (riskItems.length === 0) return null;
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          {t("scan.riskDetails.title")}
        </Text>
        <BlockStack gap="300">
          {riskItems.map((item, index) => (
            <Box
              key={index}
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="200">
                    <Icon
                      source={AlertCircleIcon}
                      tone={
                        item.severity === "high"
                          ? "critical"
                          : item.severity === "medium"
                          ? "warning"
                          : "info"
                      }
                    />
                    <Text as="span" fontWeight="semibold">
                      {item.name}
                    </Text>
                  </InlineStack>
                  {getSeverityBadge(item.severity, t)}
                </InlineStack>
                <Text as="p" tone="subdued">
                  {item.description}
                </Text>
                {item.details && (
                  <Text as="p" variant="bodySm">
                    {item.details}
                  </Text>
                )}
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200">
                    {item.platform && (
                      <Badge>{getPlatformName(item.platform, t)}</Badge>
                    )}
                    {item.impact && (
                      <Text as="span" variant="bodySm" tone="critical">
                        {t("scan.riskDetails.impact", { impact: item.impact })}
                      </Text>
                    )}
                  </InlineStack>
                  <Button
                    url={`/app/migrate${item.platform ? `?platform=${item.platform}` : ""}`}
                    size="slim"
                    icon={ArrowRightIcon}
                  >
                    {t("scan.riskDetails.oneClickMigrate")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
