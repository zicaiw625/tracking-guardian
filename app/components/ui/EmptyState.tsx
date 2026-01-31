import { memo } from "react";
import { Card, BlockStack, Text, Button, InlineStack, Box } from "@shopify/polaris";
import { EmptyStateDisplay } from "./ErrorDisplay";
import { useT } from "~/context/LocaleContext";

export interface EnhancedEmptyStateProps {
  title?: string;
  description?: string;
  primaryAction?: {
    content: string;
    onAction?: () => void;
    url?: string;
  };
  secondaryAction?: {
    content: string;
    onAction?: () => void;
    url?: string;
  };
  icon?: string;
  image?: string;
  helpText?: string;
  children?: React.ReactNode;
}

export const EnhancedEmptyState = memo(function EnhancedEmptyState({
  title: titleProp,
  description: descriptionProp,
  primaryAction,
  secondaryAction,
  icon,
  image,
  helpText,
  children,
}: EnhancedEmptyStateProps) {
  const t = useT();
  const title = titleProp ?? t("common.noData");
  const description = descriptionProp ?? t("common.noDataDesc");
  const hasActions = primaryAction || secondaryAction;
  return (
    <Card>
      <BlockStack gap="400" align="center">
        {image ? (
          <Box>
            <img
              src={image}
              alt=""
              style={{ maxWidth: "200px", height: "auto" }}
            />
          </Box>
        ) : icon ? (
          <Text as="span" variant="heading3xl">
            {icon}
          </Text>
        ) : null}
        <BlockStack gap="200" align="center">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            {description}
          </Text>
          {helpText && (
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              {helpText}
            </Text>
          )}
        </BlockStack>
        {children}
        {hasActions && (
          <InlineStack gap="200">
            {primaryAction && (
              <Button
                variant="primary"
                onClick={primaryAction.onAction}
                url={primaryAction.url}
              >
                {primaryAction.content}
              </Button>
            )}
            {secondaryAction && (
              <Button
                variant="secondary"
                onClick={secondaryAction.onAction}
                url={secondaryAction.url}
              >
                {secondaryAction.content}
              </Button>
            )}
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
});

export function EmptyStateNoData({
  primaryAction,
  secondaryAction
}: {
  primaryAction?: EnhancedEmptyStateProps["primaryAction"];
  secondaryAction?: EnhancedEmptyStateProps["secondaryAction"];
}) {
  const t = useT();
  return (
    <EnhancedEmptyState
      icon="📭"
      title={t("common.noData")}
      description={t("common.noDataDesc")}
      primaryAction={primaryAction}
      secondaryAction={secondaryAction}
    />
  );
}

export function EmptyStateNoResults({
  onReset,
  onSearch
}: {
  onReset?: () => void;
  onSearch?: () => void;
}) {
  const t = useT();
  return (
    <EnhancedEmptyState
      icon="🔍"
      title={t("common.noResults")}
      description={t("common.noResultsDesc")}
      helpText={t("common.tryAdjustSearch")}
      primaryAction={onSearch ? {
        content: t("common.searchAgain"),
        onAction: onSearch,
      } : undefined}
      secondaryAction={onReset ? {
        content: t("common.clearFilters"),
        onAction: onReset,
      } : undefined}
    />
  );
}

export function EmptyStateNotConfigured({
  onConfigure,
  configType
}: {
  onConfigure?: () => void;
  configType?: string;
}) {
  const t = useT();
  const ct = configType ?? t("common.resource");
  return (
    <EnhancedEmptyState
      icon="⚙️"
      title={t("common.configNotSet", { configType: ct })}
      description={t("common.completeConfigFirst", { configType: ct })}
      primaryAction={onConfigure ? {
        content: t("common.startConfig", { configType: ct }),
        onAction: onConfigure,
      } : undefined}
    />
  );
}

export function EmptyStateNoPermission({
  onUpgrade,
  requiredFeature
}: {
  onUpgrade?: () => void;
  requiredFeature?: string;
}) {
  const t = useT();
  const upgradeAction = onUpgrade ? {
    content: t("common.viewPlans"),
    onAction: onUpgrade,
  } : {
    content: t("common.viewPlans"),
    url: "/app/billing",
  };
  return (
    <EnhancedEmptyState
      icon="🔒"
      title={t("common.upgradeRequired")}
      description={requiredFeature
        ? t("common.featureRequiresPlan", { plan: requiredFeature })
        : t("common.currentPlanNotSupported")}
      helpText={t("common.upgradeToUnlock")}
      primaryAction={upgradeAction}
    />
  );
}

export { EmptyStateDisplay };
