import { memo } from "react";
import { Card, BlockStack, Text, Button, InlineStack, Box } from "@shopify/polaris";
import { EmptyStateDisplay } from "./ErrorDisplay";
import { useTranslation } from "react-i18next";

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
  title,
  description,
  primaryAction,
  secondaryAction,
  icon,
  image,
  helpText,
  children,
}: EnhancedEmptyStateProps) {
  const { t } = useTranslation();
  const displayTitle = title || t("emptyState.defaultTitle");
  const displayDesc = description || t("emptyState.defaultDescription");
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
            {displayTitle}
          </Text>
          <Text as="p" tone="subdued" alignment="center">
            {displayDesc}
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
  const { t } = useTranslation();
  return (
    <EnhancedEmptyState
      icon="📭"
      title={t("emptyState.noData.title")}
      description={t("emptyState.noData.description")}
      helpText={t("emptyState.noData.helpText")}
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
  const { t } = useTranslation();
  return (
    <EnhancedEmptyState
      icon="🔍"
      title={t("emptyState.noResults.title")}
      description={t("emptyState.noResults.description")}
      helpText={t("emptyState.noResults.helpText")}
      primaryAction={onSearch ? {
        content: t("emptyState.noResults.search"),
        onAction: onSearch,
      } : undefined}
      secondaryAction={onReset ? {
        content: t("emptyState.noResults.clearFilter"),
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
  const { t } = useTranslation();
  const config = configType || t("emptyState.notConfigured.defaultConfig");
  return (
    <EnhancedEmptyState
      icon="⚙️"
      title={t("emptyState.notConfigured.title", { config })}
      description={t("emptyState.notConfigured.description", { config })}
      primaryAction={onConfigure ? {
        content: t("emptyState.notConfigured.start", { config }),
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
  const { t } = useTranslation();
  const upgradeAction = onUpgrade ? {
    content: t("emptyState.noPermission.viewPlans"),
    onAction: onUpgrade,
  } : {
    content: t("emptyState.noPermission.viewPlans"),
    url: "/app/billing",
  };
  return (
    <EnhancedEmptyState
      icon="🔒"
      title={t("emptyState.noPermission.title")}
      description={requiredFeature
        ? t("emptyState.noPermission.description", { feature: requiredFeature })
        : t("emptyState.noPermission.descriptionGeneral")}
      helpText={t("emptyState.noPermission.helpText")}
      primaryAction={upgradeAction}
    />
  );
}

export { EmptyStateDisplay };
