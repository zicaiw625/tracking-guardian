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
import { useT } from "~/context/LocaleContext";

export interface PageSkeletonProps {
  cards?: number;
  showTabs?: boolean;
  primaryAction?: boolean;
}

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

export interface CardSkeletonProps {
  lines?: number;
  showTitle?: boolean;
}

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

export interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="400">
          {Array.from({ length: columns }).map((_, i) => (
            <Box key={i} minWidth="100px">
              <SkeletonDisplayText size="small" />
            </Box>
          ))}
        </InlineStack>
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
}

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

export interface InlineSpinnerProps {
  message?: string;
  size?: "small" | "large";
}

export function InlineSpinner({
  message,
  size = "small",
}: InlineSpinnerProps) {
  const t = useT();
  const displayMessage = message ?? t("common.loading");
  return (
    <InlineStack gap="200" align="center" blockAlign="center">
      <Spinner size={size} />
      {displayMessage && (
        <Text as="span" tone="subdued">
          {displayMessage}
        </Text>
      )}
    </InlineStack>
  );
}

export interface FullScreenLoadingProps {
  message?: string;
}

export function FullScreenLoading({ message }: FullScreenLoadingProps) {
  const t = useT();
  const displayMessage = message ?? t("common.loading");
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
            {displayMessage}
          </Text>
        </BlockStack>
      </div>
    </Box>
  );
}

export interface ButtonLoadingProps {
  loading: boolean;
  loadingText?: string;
  children: React.ReactNode;
}

export function buttonLoadingText(
  loading: boolean,
  loadingText: string,
  defaultText: string
): string {
  return loading ? loadingText : defaultText;
}

export interface FormSkeletonProps {
  fields?: number;
}

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
