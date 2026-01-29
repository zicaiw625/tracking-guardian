import { z } from "zod";

const ANALYTICS_EVENT_NAMES = [
  "app_onboarding_started",
  "app_install_completed",
  "app_audit_completed",
  "audit_started",
  "audit_completed",
  "migration_plan_viewed",
  "cfg_pixel_created",
  "cfg_pixel_live_enabled",
  "pixel_destination_created",
  "px_event_received",
  "px_ingest_accepted_count",
  "px_validate_failed_count",
  "px_dedup_dropped_count",
  "px_destination_ok_count",
  "px_destination_fail_count",
  "px_destination_latency_ms",
  "verification_started",
  "ver_run_completed",
  "verification_passed",
  "pixel_live_enabled",
  "app_paywall_viewed",
  "app_upgrade_clicked",
  "subscription_started",
  "app_subscription_created",
  "app_subscription_failed",
  "subscription_upgraded",
] as const;

export const AnalyticsEventSchema = z.enum(ANALYTICS_EVENT_NAMES);

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

const MetadataLeafValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
]);

const MetadataNestedValue = z.union([
  MetadataLeafValue,
  z.record(z.string().max(64), MetadataLeafValue),
]);

export const AnalyticsMetadataSchema = z
  .record(z.string().max(64), MetadataNestedValue)
  .refine((o) => Object.keys(o).length <= 30)
  .optional();

export const AnalyticsTrackBodySchema = z.object({
  event: AnalyticsEventSchema,
  metadata: AnalyticsMetadataSchema,
  eventId: z.string().max(100).optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
});
