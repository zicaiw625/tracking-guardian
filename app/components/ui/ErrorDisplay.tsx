import { Banner, Card, Text, BlockStack, Button, InlineStack } from "@shopify/polaris";

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
  title = "发生错误",
  message,
  code,
  retryable = false,
  onRetry,
  onDismiss,
  variant = "banner",
}: ErrorDisplayProps) {
  if (variant === "card") {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd" tone="critical">
            {title}
          </Text>
          <Text as="p">{message}</Text>
          {code && (
            <Text as="p" variant="bodySm" tone="subdued">
              错误代码: {code}
            </Text>
          )}
          <InlineStack gap="200">
            {retryable && onRetry && (
              <Button onClick={onRetry}>重试</Button>
            )}
            {onDismiss && (
              <Button variant="plain" onClick={onDismiss}>
                关闭
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Banner
      title={title}
      tone="critical"
      onDismiss={onDismiss}
      action={
        retryable && onRetry
          ? { content: "重试", onAction: onRetry }
          : undefined
      }
    >
      <BlockStack gap="200">
        <Text as="p">{message}</Text>
        {code && (
          <Text as="p" variant="bodySm" tone="subdued">
            错误代码: {code}
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

  const message = error.message || error.error || "发生未知错误";
  const code = error.code;

  if (error.details && error.details.length > 0) {
    return (
      <Banner
        title="输入验证失败"
        tone="warning"
        onDismiss={onDismiss}
        action={
          onRetry
            ? { content: "重试", onAction: onRetry }
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
  return (
    <ErrorDisplay
      title="网络连接错误"
      message="无法连接到服务器，请检查您的网络连接后重试。"
      retryable={!!onRetry}
      onRetry={onRetry}
    />
  );
}

export interface NotFoundProps {
  resource?: string;
  onBack?: () => void;
}

export function NotFoundDisplay({ resource = "资源", onBack }: NotFoundProps) {
  return (
    <Card>
      <BlockStack gap="400" align="center">
        <Text as="h2" variant="headingLg">
          未找到
        </Text>
        <Text as="p" tone="subdued">
          请求的{resource}不存在或已被删除。
        </Text>
        {onBack && (
          <Button onClick={onBack}>返回</Button>
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
  title = "暂无数据",
  message = "当前没有可显示的内容。",
  action,
}: EmptyStateProps) {
  return (
    <Card>
      <BlockStack gap="400" align="center">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Text as="p" tone="subdued">
          {message}
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
