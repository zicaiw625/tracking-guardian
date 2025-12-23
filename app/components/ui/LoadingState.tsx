/**
 * Loading State Components
 *
 * Reusable components for displaying loading states.
 */

import {
  Card,
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonTabs,
  BlockStack,
  InlineStack,
  Box,
  Spinner,
  Text,
} from "@shopify/polaris";

// =============================================================================
// Full Page Skeleton
// =============================================================================

export interface PageSkeletonProps {
  /** Number of cards to show */
  cards?: number;
  /** Show tabs */
  showTabs?: boolean;
  /** Primary action placeholder */
  primaryAction?: boolean;
}

/**
 * Full page skeleton loader
 */
export function PageSkeleton({
  cards = 2,
  showTabs = false,
  primaryAction = false,
}: PageSkeletonProps) {
  return (
    <SkeletonPage
      title=""
      primaryAction={primaryAction}
    >
      {showTabs && <SkeletonTabs count={4} />}
      <BlockStack gap="400">
        {Array.from({ length: cards }).map((_, i) => (
          <Card key={i}>
            <BlockStack gap="400">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={3} />
            </BlockStack>
          </Card>
        ))}
      </BlockStack>
    </SkeletonPage>
  );
}

// =============================================================================
// Card Skeleton
// =============================================================================

export interface CardSkeletonProps {
  /** Number of body text lines */
  lines?: number;
  /** Show title */
  showTitle?: boolean;
}

/**
 * Single card skeleton loader
 */
export function CardSkeleton({ lines = 3, showTitle = true }: CardSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="400">
        {showTitle && <SkeletonDisplayText size="small" />}
        <SkeletonBodyText lines={lines} />
      </BlockStack>
    </Card>
  );
}

// =============================================================================
// Table Skeleton
// =============================================================================

export interface TableSkeletonProps {
  /** Number of rows */
  rows?: number;
  /** Number of columns */
  columns?: number;
}

/**
 * Table skeleton loader
 */
export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="300">
        {/* Header row */}
        <InlineStack gap="400">
          {Array.from({ length: columns }).map((_, i) => (
            <Box key={i} minWidth="100px">
              <SkeletonDisplayText size="small" />
            </Box>
          ))}
        </InlineStack>

        {/* Body rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <InlineStack key={rowIndex} gap="400">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <Box key={colIndex} minWidth="100px">
                <SkeletonBodyText lines={1} />
              </Box>
            ))}
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}

// =============================================================================
// Stats Skeleton
// =============================================================================

export interface StatsSkeletonProps {
  /** Number of stat cards */
  count?: number;
}

/**
 * Stats cards skeleton loader
 */
export function StatsSkeleton({ count = 3 }: StatsSkeletonProps) {
  return (
    <InlineStack gap="400" wrap={false}>
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} minWidth="200px">
          <Card>
            <BlockStack gap="200">
              <SkeletonBodyText lines={1} />
              <SkeletonDisplayText size="medium" />
            </BlockStack>
          </Card>
        </Box>
      ))}
    </InlineStack>
  );
}

// =============================================================================
// Inline Loading Spinner
// =============================================================================

export interface InlineSpinnerProps {
  /** Loading message */
  message?: string;
  /** Spinner size */
  size?: "small" | "large";
}

/**
 * Inline loading spinner with optional message
 */
export function InlineSpinner({
  message = "加载中...",
  size = "small",
}: InlineSpinnerProps) {
  return (
    <InlineStack gap="200" align="center" blockAlign="center">
      <Spinner size={size} />
      {message && (
        <Text as="span" tone="subdued">
          {message}
        </Text>
      )}
    </InlineStack>
  );
}

// =============================================================================
// Full Screen Loading
// =============================================================================

export interface FullScreenLoadingProps {
  /** Loading message */
  message?: string;
}

/**
 * Full screen loading overlay
 */
export function FullScreenLoading({ message = "加载中..." }: FullScreenLoadingProps) {
  return (
    <Box
      position="relative"
      minHeight="400px"
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <BlockStack gap="400" align="center">
          <Spinner size="large" />
          <Text as="p" variant="bodyMd" tone="subdued">
            {message}
          </Text>
        </BlockStack>
      </div>
    </Box>
  );
}

// =============================================================================
// Button Loading State
// =============================================================================

export interface ButtonLoadingProps {
  /** Whether loading */
  loading: boolean;
  /** Loading message */
  loadingText?: string;
  /** Default text */
  children: React.ReactNode;
}

/**
 * Helper for button loading states
 * Usage: <Button loading={isLoading}>{buttonLoading(isLoading, "保存中...", "保存")}</Button>
 */
export function buttonLoadingText(
  loading: boolean,
  loadingText: string,
  defaultText: string
): string {
  return loading ? loadingText : defaultText;
}

// =============================================================================
// Form Skeleton
// =============================================================================

export interface FormSkeletonProps {
  /** Number of fields */
  fields?: number;
}

/**
 * Form skeleton loader
 */
export function FormSkeleton({ fields = 4 }: FormSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="400">
        {Array.from({ length: fields }).map((_, i) => (
          <BlockStack key={i} gap="200">
            <SkeletonBodyText lines={1} />
            <Box
              background="bg-surface-secondary"
              padding="300"
              borderRadius="200"
            >
              <SkeletonBodyText lines={1} />
            </Box>
          </BlockStack>
        ))}
        <InlineStack gap="200">
          <Box width="100px">
            <SkeletonDisplayText size="small" />
          </Box>
          <Box width="80px">
            <SkeletonBodyText lines={1} />
          </Box>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

