import { Banner, BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";
import { getPlanOrDefault } from "~/services/billing/plans";
import { isPlanAtLeast, normalizePlan } from "~/utils/plans";
import { useTranslation } from "react-i18next";

interface AuditPaywallCardProps {
  planId: string | null | undefined;
}

export function AuditPaywallCard({ planId }: AuditPaywallCardProps) {
  const { t } = useTranslation();
  const planIdSafe = normalizePlan(planId);
  const isStarter = isPlanAtLeast(planIdSafe, "starter");
  const isGrowth = isPlanAtLeast(planIdSafe, "growth");
  const isAgency = isPlanAtLeast(planIdSafe, "agency");
  const starterPlan = getPlanOrDefault("starter");
  const growthPlan = getPlanOrDefault("growth");
  const agencyPlan = getPlanOrDefault("agency");
  const starterName = t(starterPlan.name);
  const growthName = t(growthPlan.name);
  const agencyName = t(agencyPlan.name);
  const priceLabel = (price: number) => t("auditPaywall.pricePerMonth", { price });

  const migrationLabel = isStarter
    ? t("auditPaywall.migratePixel")
    : t("auditPaywall.migratePixelWithPlan", { plan: starterName, price: priceLabel(starterPlan.price) });
  const moduleLabel = isStarter
    ? t("auditPaywall.pageCustomization")
    : t("auditPaywall.pageCustomizationWithPlan", { plan: starterName, price: priceLabel(starterPlan.price) });

  const bannerLines = (() => {
    if (!isStarter) {
      return [
        {
          label: t("auditPaywall.freeFeatures"),
          text: t("auditPaywall.freeDesc"),
        },
        {
          label: t("auditPaywall.paidUnlock"),
          text: t("auditPaywall.paidDesc", { plan: starterName, price: priceLabel(starterPlan.price) }),
        },
      ];
    }
    if (!isGrowth) {
      return [
        {
          label: t("auditPaywall.unlocked"),
          text: t("auditPaywall.starterUnlocked", { plan: starterName }),
        },
        {
          label: t("auditPaywall.upgradeUnlock"),
          text: t("auditPaywall.growthUnlock", { plan: growthName }),
        },
      ];
    }
    if (!isAgency) {
      return [
        {
          label: t("auditPaywall.unlocked"),
          text: t("auditPaywall.growthUnlocked", { plan: growthName }),
        },
        {
          label: t("auditPaywall.upgradeUnlock"),
          text: t("auditPaywall.agencyUnlock", { plan: agencyName }),
        },
      ];
    }
    return [
      {
        label: t("auditPaywall.unlocked"),
        text: t("auditPaywall.agencyUnlocked"),
      },
      {
        label: t("auditPaywall.needHelp"),
        text: t("auditPaywall.contactCSM"),
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
  const upgradePlanName = upgradePlan ? t(upgradePlan.name) : "";

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {t("auditPaywall.title")}
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
            url={isStarter ? "/app/migrate" : "/app/billing?upgrade=starter"}
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
              {t("auditPaywall.upgradeTo", { plan: upgradePlanName, price: priceLabel(upgradePlan.price) })}
            </Button>
          )}
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
