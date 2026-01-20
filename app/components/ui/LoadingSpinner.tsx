import { Spinner, BlockStack, Text } from "@shopify/polaris";
import React from "react";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  label?: string;
  fullScreen?: boolean;
  style?: React.CSSProperties;
}

export function LoadingSpinner({
  size = "large",
  label,
  fullScreen = false,
  style,
}: LoadingSpinnerProps) {
  const content = (
    <BlockStack gap="300" align="center" inlineAlign="center">
      <Spinner size={size} accessibilityLabel={label || "加载中"} />
      {label && (
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
      )}
    </BlockStack>
  );
  if (fullScreen) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255, 255, 255, 0.8)",
          zIndex: 1000,
          ...style,
        }}
      >
        {content}
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "var(--p-space-400)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "200px",
        ...style,
      }}
    >
      {content}
    </div>
  );
}

interface SkeletonProps {
  lines?: number;
  showAvatar?: boolean;
  showTitle?: boolean;
}

export function Skeleton({
  lines = 3,
  showAvatar = false,
  showTitle = true,
}: SkeletonProps) {
  return (
    <div className="skeleton-container">
      <style>
        {`
          .skeleton-container {
            display: flex;
            gap: 16px;
          }
          .skeleton-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
          }
          .skeleton-content {
            flex: 1;
          }
          .skeleton-title {
            height: 20px;
            width: 60%;
            margin-bottom: 12px;
            border-radius: 4px;
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
          }
          .skeleton-line {
            height: 14px;
            margin-bottom: 8px;
            border-radius: 4px;
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
          }
          .skeleton-line:last-child {
            width: 80%;
          }
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}
      </style>
      {showAvatar && <div className="skeleton-avatar" />}
      <div className="skeleton-content">
        {showTitle && <div className="skeleton-title" />}
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="skeleton-line" />
        ))}
      </div>
    </div>
  );
}

interface PageLoadingProps {
  title?: string;
}

export function PageLoading({ title = "加载中..." }: PageLoadingProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "400px",
        padding: "40px",
      }}
    >
      <Spinner size="large" accessibilityLabel={title} />
      <Text as="p" variant="bodyMd" tone="subdued">
        {title}
      </Text>
    </div>
  );
}

interface LazyLoadWrapperProps {
  children: React.ReactNode;
  isLoading: boolean;
  loadingComponent?: React.ReactNode;
  minHeight?: string | number;
}

export function LazyLoadWrapper({
  children,
  isLoading,
  loadingComponent,
  minHeight = "200px",
}: LazyLoadWrapperProps) {
  if (isLoading) {
    return (
      <div style={{ minHeight }}>
        {loadingComponent || <LoadingSpinner label="加载中..." />}
      </div>
    );
  }
  return <>{children}</>;
}
