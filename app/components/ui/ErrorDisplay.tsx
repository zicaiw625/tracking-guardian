import { Banner, Card, Text, BlockStack, Button, InlineStack } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

export interface ErrorDisplayProps {
  title?: string;
  message: string;
  code?: string;
  retryable?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: "banner" | "card";
}

export interface ApiErrorDisplayProps {
  error: {
    message?: string;
    error?: string;
    code?: string;
    details?: Array<{ field: string; message: string }>;
  } | string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorDisplay({
  title,
  message,
  code,
  retryable = false,
  onRetry,
  onDismiss,
  variant = "banner",
}: ErrorDisplayProps) {
  const { t } = useTranslation();
  const displayTitle = title || t("ui.error.title");

  if (variant === "card") {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd" tone="critical">
            {displayTitle}
          </Text>
          <Text as="p">{message}</Text>
          {code && (
            <Text as="p" variant="bodySm" tone="subdued">
              {t("ui.error.code", { code })}
            </Text>
          )}
          <InlineStack gap="200">
            {retryable && onRetry && (
              <Button onClick={onRetry}>{t("ui.error.retry")}</Button>
            )}
            {onDismiss && (
              <Button variant="plain" onClick={onDismiss}>
                {t("ui.error.close")}
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }
  return (
    <Banner
      title={displayTitle}
      tone="critical"
      onDismiss={onDismiss}
      action={
        retryable && onRetry
          ? { content: t("ui.error.retry"), onAction: onRetry }
          : undefined
      }
    >
      <BlockStack gap="200">
        <Text as="p">{message}</Text>
        {code && (
          <Text as="p" variant="bodySm" tone="subdued">
            {t("ui.error.code", { code })}
          </Text>
        )}
      </BlockStack>
    </Banner>
  );
}

export function ApiErrorDisplay({
  error,
  onRetry,
  onDismiss,
}: ApiErrorDisplayProps) {
  const { t } = useTranslation();
  if (!error) return null;
  if (typeof error === "string") {
    return (
      <ErrorDisplay
        message={error}
        retryable={!!onRetry}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    );
  }
  const message = error.message || error.error || t("ui.error.api.unknown");
  const code = error.code;
  if (error.details && error.details.length > 0) {
    return (
      <Banner
        title={t("ui.error.validation.title")}
        tone="warning"
        onDismiss={onDismiss}
        action={
          onRetry
            ? { content: t("ui.error.retry"), onAction: onRetry }
            : undefined
        }
      >
        <BlockStack gap="200">
          {error.details.map((detail, index) => (
            <Text key={index} as="p">
              <Text as="span" fontWeight="semibold">{detail.field}:</Text>{" "}
              {detail.message}
            </Text>
          ))}
        </BlockStack>
      </Banner>
    );
  }
  return (
    <ErrorDisplay
      message={message}
      code={code}
      retryable={!!onRetry}
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  );
}

export interface NetworkErrorProps {
  onRetry?: () => void;
}

export function NetworkErrorDisplay({ onRetry }: NetworkErrorProps) {
  const { t } = useTranslation();
  return (
    <ErrorDisplay
      title={t("ui.error.network.title")}
      message={t("ui.error.network.message")}
      retryable={!!onRetry}
      onRetry={onRetry}
    />
  );
}

export interface NotFoundProps {
  resource?: string;
  onBack?: () => void;
}

export function NotFoundDisplay({ resource, onBack }: NotFoundProps) {
  const { t } = useTranslation();
  const displayResource = resource || t("ui.error.notFound.resource");
  return (
    <Card>
      <BlockStack gap="400" align="center">
        <Text as="h2" variant="headingLg">
          {t("ui.error.notFound.title")}
        </Text>
        <Text as="p" tone="subdued">
          {t("ui.error.notFound.message", { resource: displayResource })}
        </Text>
        {onBack && (
          <Button onClick={onBack}>{t("ui.error.back")}</Button>
        )}
      </BlockStack>
    </Card>
  );
}

export interface EmptyStateProps {
  title?: string;
  message?: string;
  action?: {
    content: string;
    onAction: () => void;
  };
}

export function EmptyStateDisplay({
  title,
  message,
  action,
}: EmptyStateProps) {
  const { t } = useTranslation();
  const displayTitle = title || t("ui.emptyState.title");
  const displayMessage = message || t("ui.emptyState.description");
  return (
    <Card>
      <BlockStack gap="400" align="center">
        <Text as="h2" variant="headingMd">
          {displayTitle}
        </Text>
        <Text as="p" tone="subdued">
          {displayMessage}
        </Text>
        {action && (
          <Button variant="primary" onClick={action.onAction}>
            {action.content}
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}
