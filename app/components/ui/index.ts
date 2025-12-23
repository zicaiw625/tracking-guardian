/**
 * UI Component Exports
 *
 * Centralized exports for all reusable UI components.
 */

// =============================================================================
// Error Display Components
// =============================================================================

export {
  ErrorDisplay,
  ApiErrorDisplay,
  NetworkErrorDisplay,
  NotFoundDisplay,
  EmptyStateDisplay,
  type ErrorDisplayProps,
  type ApiErrorDisplayProps,
  type NetworkErrorProps,
  type NotFoundProps,
  type EmptyStateProps,
} from "./ErrorDisplay";

// =============================================================================
// Loading State Components
// =============================================================================

export {
  PageSkeleton,
  CardSkeleton,
  TableSkeleton,
  StatsSkeleton,
  InlineSpinner,
  FullScreenLoading,
  FormSkeleton,
  buttonLoadingText,
  type PageSkeletonProps,
  type CardSkeletonProps,
  type TableSkeletonProps,
  type StatsSkeletonProps,
  type InlineSpinnerProps,
  type FullScreenLoadingProps,
  type FormSkeletonProps,
} from "./LoadingState";

// =============================================================================
// Status Badge Components
// =============================================================================

export {
  StatusBadge,
  JobStatusBadge,
  HealthStatusBadge,
  PlatformStatusBadge,
  RiskScoreBadge,
  PlanBadge,
  BooleanStatus,
  StatusWithCount,
  type StatusType,
  type JobStatus,
  type HealthStatus,
  type PlatformStatus,
  type StatusBadgeProps,
  type JobStatusBadgeProps,
  type HealthStatusBadgeProps,
  type PlatformStatusBadgeProps,
  type RiskScoreBadgeProps,
  type PlanBadgeProps,
  type BooleanStatusProps,
  type StatusWithCountProps,
} from "./StatusBadge";

// =============================================================================
// Metric Card Components
// =============================================================================

export {
  MetricCard,
  ProgressMetricCard,
  ComparisonMetricCard,
  MetricGrid,
  StatItem,
  type MetricCardProps,
  type ProgressMetricCardProps,
  type ComparisonMetricCardProps,
  type MetricGridProps,
  type StatItemProps,
  type TrendDirection,
  type MetricValue,
} from "./MetricCard";

