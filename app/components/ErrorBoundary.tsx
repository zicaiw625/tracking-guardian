

import { useRouteError, isRouteErrorResponse, Link } from "@remix-run/react";
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
  return (
    <Page>
      <Card>
        <BlockStack gap="400">
          <Banner title={title} tone="critical">
            <BlockStack gap="200">
              <Text as="p">{message}</Text>
              {status && (
                <Text as="p" variant="bodySm" tone="subdued">
                  错误代码: {status}
                </Text>
              )}
            </BlockStack>
          </Banner>

          <InlineStack gap="200">
            {showHomeButton && (
              <Link to="/app">
                <Button variant="primary">返回首页</Button>
              </Link>
            )}
            {showRetryButton && onRetry && (
              <Button onClick={onRetry}>重试</Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}

const HTTP_ERROR_MESSAGES: Record<number, { title: string; message: string }> = {
  400: {
    title: "请求无效",
    message: "您的请求格式不正确，请检查后重试。",
  },
  401: {
    title: "未授权",
    message: "您需要登录才能访问此页面。",
  },
  403: {
    title: "访问被拒绝",
    message: "您没有权限访问此资源。",
  },
  404: {
    title: "页面未找到",
    message: "您访问的页面不存在或已被移除。",
  },
  429: {
    title: "请求过于频繁",
    message: "您的请求过于频繁，请稍后再试。",
  },
  500: {
    title: "服务器错误",
    message: "服务器发生内部错误，请稍后重试。",
  },
  502: {
    title: "网关错误",
    message: "服务暂时不可用，请稍后重试。",
  },
  503: {
    title: "服务不可用",
    message: "服务正在维护中，请稍后重试。",
  },
  504: {
    title: "网关超时",
    message: "请求超时，请检查网络连接后重试。",
  },
};

function getHttpErrorInfo(status: number): { title: string; message: string } {
  return (
    HTTP_ERROR_MESSAGES[status] || {
      title: `错误 ${status}`,
      message: "发生了未知错误，请稍后重试。",
    }
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    const { title, message } = getHttpErrorInfo(error.status);
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
        title="发生错误"
        message={
          isDev
            ? error.message
            : "抱歉，发生了意外错误。我们的团队已收到通知。"
        }
        showHomeButton={true}
        showRetryButton={true}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <ErrorCard
      title="未知错误"
      message="发生了未知错误，请刷新页面或返回首页。"
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
  return (
    <Box padding="400">
      <Banner title={title} tone="critical">
        <BlockStack gap="200">
          <Text as="p">{message}</Text>
          {onRetry && (
            <Button size="slim" onClick={onRetry}>
              重试
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
  const message =
    typeof error === "string"
      ? error
      : error?.message || "加载数据时发生错误";

  return (
    <Banner title="加载失败" tone="critical">
      <BlockStack gap="200">
        <Text as="p">{message}</Text>
        {onRetry && (
          <Button size="slim" onClick={onRetry}>
            重新加载
          </Button>
        )}
      </BlockStack>
    </Banner>
  );
}

export default RouteErrorBoundary;

