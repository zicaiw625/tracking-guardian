import { useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
import { useTranslation } from "react-i18next";
import {
  Page,
  Card,
  Text,
  BlockStack,
  Button,
  Banner,
  InlineStack,
  Box,
} from "@shopify/polaris";

interface ErrorDisplayProps {
  title: string;
  message: string;
  status?: number;
  showHomeButton?: boolean;
  showRetryButton?: boolean;
  onRetry?: () => void;
}

export function ErrorCard({
  title,
  message,
  status,
  showHomeButton = true,
  showRetryButton = false,
  onRetry,
}: ErrorDisplayProps) {
  const { t } = useTranslation();
  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <Banner title={title} tone="critical">
            <BlockStack gap="200">
              <Text as="p">{message}</Text>
              {status && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("errorPage.errorCode")} {status}
                </Text>
              )}
            </BlockStack>
          </Banner>
          <InlineStack gap="200">
            {showHomeButton && (
              <Link to="/app">
                <Button variant="primary">{t("errorPage.backToHome")}</Button>
              </Link>
            )}
            {showRetryButton && onRetry && (
              <Button onClick={onRetry}>{t("errorPage.retry")}</Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}

// Helper to get error info using t function
function getHttpErrorInfo(status: number, t: (key: string) => string): { title: string; message: string } {
  const errorKey = `errorPage.http.${status}`;
  
  const knownStatuses = [400, 401, 403, 404, 429, 500, 502, 503, 504];
  if (knownStatuses.includes(status)) {
     return {
         title: t(`${errorKey}.title`),
         message: t(`${errorKey}.message`)
     };
  }

  return {
    title: t("errorPage.unknownError"), // Or maybe just "Error {status}"
    message: t("errorPage.unknownMessage"),
  };
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const { t } = useTranslation();
  
  if (isRouteErrorResponse(error)) {
    const { title, message } = getHttpErrorInfo(error.status, t);
    return (
      <ErrorCard
        title={title}
        message={error.data?.message || message}
        status={error.status}
        showHomeButton={true}
        showRetryButton={error.status >= 500}
        onRetry={() => window.location.reload()}
      />
    );
  }
  if (error instanceof Error) {
    const isDev = process.env.NODE_ENV !== "production";
    return (
      <ErrorCard
        title={t("errorPage.defaultMessage")}
        message={
          isDev
            ? error.message
            : t("errorPage.unexpectedError")
        }
        showHomeButton={true}
        showRetryButton={true}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return (
    <ErrorCard
      title={t("errorPage.unknownTitle")}
      message={t("errorPage.unknownMessage")}
      showHomeButton={true}
      showRetryButton={true}
      onRetry={() => window.location.reload()}
    />
  );
}

export function InlineError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box padding="400">
      <Banner title={title} tone="critical">
        <BlockStack gap="200">
          <Text as="p">{message}</Text>
          {onRetry && (
            <Button size="slim" onClick={onRetry}>
              {t("errorPage.retry")}
            </Button>
          )}
        </BlockStack>
      </Banner>
    </Box>
  );
}

export function ErrorEmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: {
    content: string;
    onAction: () => void;
  };
}) {
  return (
    <Card>
      <BlockStack gap="300" align="center">
        <Text as="h3" variant="headingMd">
          {title}
        </Text>
        <Text as="p" tone="subdued">
          {message}
        </Text>
        {action && <Button onClick={action.onAction}>{action.content}</Button>}
      </BlockStack>
    </Card>
  );
}

export function LoadingError({
  error,
  onRetry,
}: {
  error: Error | string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const message =
    typeof error === "string"
      ? error
      : error?.message || t("errorPage.loadDataError");
  return (
    <Banner title={t("errorPage.loadFailed")} tone="critical">
      <BlockStack gap="200">
        <Text as="p">{message}</Text>
        {onRetry && (
          <Button size="slim" onClick={onRetry}>
            {t("errorPage.reload")}
          </Button>
        )}
      </BlockStack>
    </Banner>
  );
}

export default RouteErrorBoundary;
