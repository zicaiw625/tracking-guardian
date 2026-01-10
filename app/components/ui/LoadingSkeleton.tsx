import {
  SkeletonPage,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonTabs,
  Card,
  BlockStack,
  InlineStack,
  Box,
  SkeletonThumbnail,
} from "@shopify/polaris";

export interface PageSkeletonProps {
  cards?: number;
  showTabs?: boolean;
  primaryAction?: boolean;
  title?: string;
}

export function PageSkeleton({
  cards = 2,
  showTabs = false,
  primaryAction = false,
  title,
}: PageSkeletonProps) {
  return (
    <SkeletonPage
      title={title}
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

export interface CardSkeletonProps {
  lines?: number;
  showTitle?: boolean;
  showImage?: boolean;
}

export function CardSkeleton({
  lines = 3,
  showTitle = true,
  showImage = false,
}: CardSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="400">
        {showImage && (
          <SkeletonThumbnail size="large" />
        )}
        {showTitle && <SkeletonDisplayText size="small" />}
        <SkeletonBodyText lines={lines} />
      </BlockStack>
    </Card>
  );
}

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
  showHeader = true,
}: TableSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="300">
        {showHeader && (
          <InlineStack gap="400">
            {Array.from({ length: columns }).map((_, i) => (
              <Box key={i} minWidth="100px">
                <SkeletonDisplayText size="small" />
              </Box>
            ))}
          </InlineStack>
        )}
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

export interface StatsSkeletonProps {
  count?: number;
  showTrend?: boolean;
}

export function StatsSkeleton({ count = 3, showTrend = false }: StatsSkeletonProps) {
  return (
    <InlineStack gap="400" wrap={false}>
      {Array.from({ length: count }).map((_, i) => (
        <Box key={i} minWidth="200px">
          <Card>
            <BlockStack gap="200">
              <SkeletonBodyText lines={1} />
              <SkeletonDisplayText size="medium" />
              {showTrend && (
                <InlineStack gap="200" blockAlign="center">
                  <SkeletonBodyText lines={1} />
                  <SkeletonBodyText lines={1} />
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Box>
      ))}
    </InlineStack>
  );
}

export interface ListSkeletonProps {
  items?: number;
  showAvatar?: boolean;
}

export function ListSkeleton({ items = 5, showAvatar = false }: ListSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="300">
        {Array.from({ length: items }).map((_, i) => (
          <InlineStack key={i} gap="300" blockAlign="center">
            {showAvatar && (
              <SkeletonThumbnail size="small" />
            )}
            <Box>
              <SkeletonBodyText lines={2} />
            </Box>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}

export interface FormSkeletonProps {
  fields?: number;
  showActions?: boolean;
}

export function FormSkeleton({ fields = 4, showActions = true }: FormSkeletonProps) {
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
              minHeight="44px"
            >
              <SkeletonBodyText lines={1} />
            </Box>
          </BlockStack>
        ))}
        {showActions && (
          <InlineStack gap="200">
            <Box width="100px">
              <SkeletonDisplayText size="small" />
            </Box>
            <Box width="80px">
              <SkeletonBodyText lines={1} />
            </Box>
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <BlockStack gap="500">
      <StatsSkeleton count={3} showTrend />
      <InlineStack gap="400" blockAlign="stretch" wrap={false}>
        <Box minWidth="33%">
          <CardSkeleton lines={4} />
        </Box>
        <Box minWidth="33%">
          <CardSkeleton lines={4} />
        </Box>
        <Box minWidth="33%">
          <CardSkeleton lines={4} />
        </Box>
      </InlineStack>
      <CardSkeleton lines={6} />
    </BlockStack>
  );
}
