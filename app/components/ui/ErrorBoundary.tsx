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
    if (typeof window !== "undefined" && window.console) {
      console.error("ErrorBoundary caught an error:", error, errorInfo);
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
      const errorMessage = this.state.error?.message || "发生了未知错误";
      const errorStack = isDev && this.state.error?.stack ? this.state.error.stack : null;
      return (
        <Page>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="start" gap="200">
                <Icon source={AlertCircleIcon} tone="critical" />
                <Text as="h2" variant="headingMd">
                  出错了
                </Text>
              </InlineStack>
              <Banner tone="critical">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    {errorMessage}
                  </Text>
                  <Text as="p" variant="bodySm">
                    我们已记录此错误。请尝试以下解决方案：
                  </Text>
                  <List type="bullet">
                    <List.Item>刷新页面重试</List.Item>
                    <List.Item>检查网络连接</List.Item>
                    <List.Item>清除浏览器缓存后重试</List.Item>
                    <List.Item>如果问题持续，请联系技术支持</List.Item>
                  </List>
                </BlockStack>
              </Banner>
              {isDev && errorStack && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">
                      错误详情（仅开发环境）
                    </Text>
                    <Box
                      padding="300"
                      background="bg-surface-secondary"
                      borderRadius="100"
                    >
                      <pre
                        style={{
                          margin: 0,
                          fontSize: "12px",
                          overflow: "auto",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {errorStack}
                      </pre>
                    </Box>
                  </BlockStack>
                </Card>
              )}
              <InlineStack gap="200">
                <Button variant="primary" onClick={this.handleReload} icon={RefreshIcon}>
                  刷新页面
                </Button>
                <Button onClick={this.handleReset}>
                  重试
                </Button>
                <Button url="/app" variant="tertiary">
                  返回首页
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Page>
      );
    }
    return this.props.children;
  }
}
