import { Spinner, BlockStack, Text } from "@shopify/polaris";
import React from "react";
import { useTranslation } from "react-i18next";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  label?: string;
  fullScreen?: boolean;
}

export function LoadingSpinner({
  size = "large",
  label,
  fullScreen = false,
}: LoadingSpinnerProps) {
  const { t } = useTranslation();
  const displayLabel = label || t("common.loading");
  const content = (
    <BlockStack gap="300" align="center" inlineAlign="center">
      <Spinner size={size} accessibilityLabel={displayLabel} />
      {displayLabel && (
        <Text as="p" variant="bodySm" tone="subdued">
          {displayLabel}
        </Text>
      )}
    </BlockStack>
  );
  if (fullScreen) {
    return (
      <div className="tg-loading-spinner-fullscreen">
        {content}
      </div>
    );
  }
  return (
    <div className="tg-loading-spinner-inline">
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
    <div className="tg-skeleton-container">
      {showAvatar && <div className="tg-skeleton-avatar" />}
      <div className="tg-skeleton-content">
        {showTitle && <div className="tg-skeleton-title" />}
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="tg-skeleton-line" />
        ))}
      </div>
    </div>
  );
}

interface PageLoadingProps {
  title?: string;
}

export function PageLoading({ title }: PageLoadingProps) {
  const { t } = useTranslation();
  const displayTitle = title || t("common.loading");
  return (
    <div className="tg-page-loading">
      <Spinner size="large" accessibilityLabel={displayTitle} />
      <Text as="p" variant="bodyMd" tone="subdued">
        {displayTitle}
      </Text>
    </div>
  );
}

interface LazyLoadWrapperProps {
  children: React.ReactNode;
  isLoading: boolean;
  loadingComponent?: React.ReactNode;
}

export function LazyLoadWrapper({
  children,
  isLoading,
  loadingComponent,
}: LazyLoadWrapperProps) {
  const { t } = useTranslation();
  if (isLoading) {
    return (
      <div className="tg-lazy-load-wrapper">
        {loadingComponent || <LoadingSpinner label={t("common.loading")} />}
      </div>
    );
  }
  return <>{children}</>;
}
