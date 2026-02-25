import { Component, type ReactNode } from "react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  List,
  Icon,
  Box,
} from "@shopify/polaris";
import { AlertCircleIcon, RefreshIcon } from "~/components/icons";
import { useTranslation } from "react-i18next";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: { componentStack: string } | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: { componentStack: string }) => void;
}

function ErrorFallbackContent({
  errorMessage,
  errorStack,
  isDev,
  onReset,
  onReload,
}: {
  errorMessage: string;
  errorStack: string | null;
  isDev: boolean;
  onReset: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <InlineStack align="start" gap="200">
            <Icon source={AlertCircleIcon} tone="critical" />
            <Text as="h2" variant="headingMd">
              {t("errorBoundary.title")}
            </Text>
          </InlineStack>
          <Banner tone="critical">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {errorMessage}
              </Text>
              <Text as="p" variant="bodySm">
                {t("errorBoundary.description")}
              </Text>
              <List type="bullet">
                <List.Item>{t("errorBoundary.refreshPage")}</List.Item>
                <List.Item>{t("errorBoundary.checkNetwork")}</List.Item>
                <List.Item>{t("errorBoundary.clearCache")}</List.Item>
                <List.Item>{t("errorBoundary.contactSupport")}</List.Item>
              </List>
            </BlockStack>
          </Banner>
          {isDev && errorStack && (
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  {t("errorBoundary.errorDetails")}
                </Text>
                <Box
                  padding="300"
                  background="bg-surface-secondary"
                  borderRadius="100"
                >
                  <pre className="tg-ui-error-stack">
                    {errorStack}
                  </pre>
                </Box>
              </BlockStack>
            </Card>
          )}
          <InlineStack gap="200">
            <Button variant="primary" onClick={onReload} icon={RefreshIcon}>
              {t("errorBoundary.refreshButton")}
            </Button>
            <Button onClick={onReset}>
              {t("errorBoundary.retryButton")}
            </Button>
            <Button url="/app" variant="tertiary">
              {t("errorBoundary.homeButton")}
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }
  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    this.setState({
      error,
      errorInfo,
    });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
    if (typeof window !== "undefined") {
      import("../../utils/debug-log.client").then(({ debugError }) => {
        debugError("ErrorBoundary caught an error:", error, errorInfo);
      });
    }
  }
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };
  handleReload = () => {
    window.location.reload();
  };
  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const isDev = process.env.NODE_ENV === "development";
      const errorMessage = this.state.error?.message || "Unknown error";
      const errorStack = isDev && this.state.error?.stack ? this.state.error.stack : null;
      return (
        <ErrorFallbackContent
          errorMessage={errorMessage}
          errorStack={errorStack}
          isDev={isDev}
          onReset={this.handleReset}
          onReload={this.handleReload}
        />
      );
    }
    return this.props.children;
  }
}
