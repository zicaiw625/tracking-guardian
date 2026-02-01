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
  const hasActions = primaryAction || secondaryAction;

  const displayTitle = title || t("ui.emptyState.title");
  const displayDescription = description || t("ui.emptyState.description");

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
            {displayDescription}
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
      title={t("ui.emptyState.title")}
      description={t("ui.emptyState.description")}
      helpText={t("ui.emptyState.helpText")}
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
      title={t("ui.emptyState.noResults.title")}
      description={t("ui.emptyState.noResults.description")}
      helpText={t("ui.emptyState.noResults.helpText")}
      primaryAction={onSearch ? {
        content: t("ui.emptyState.search.content"),
        onAction: onSearch,
      } : undefined}
      secondaryAction={onReset ? {
        content: t("ui.emptyState.reset.content"),
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
  const finalConfigType = configType || t("ui.common.config");
  return (
    <EnhancedEmptyState
      icon="⚙️"
      title={t("ui.emptyState.notConfigured.title", { configType: finalConfigType })}
      description={t("ui.emptyState.notConfigured.description", { configType: finalConfigType })}
      primaryAction={onConfigure ? {
        content: t("ui.emptyState.notConfigured.action", { configType: finalConfigType }),
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
    content: t("ui.emptyState.noPermission.action"),
    onAction: onUpgrade,
  } : {
    content: t("ui.emptyState.noPermission.action"),
    url: "/app/billing",
  };
  return (
    <EnhancedEmptyState
      icon="🔒"
      title={t("ui.emptyState.noPermission.title")}
      description={requiredFeature
        ? t("ui.emptyState.noPermission.descriptionWithFeature", { requiredFeature })
        : t("ui.emptyState.noPermission.description")}
      helpText={t("ui.emptyState.noPermission.helpText")}
      primaryAction={upgradeAction}
    />
  );
}

export { EmptyStateDisplay };
