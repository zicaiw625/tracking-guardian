import type { RejectionReason } from "./rejection-tracker.server";

const HIGH_FREQ_REASONS: RejectionReason[] = ["invalid_payload", "origin_not_allowlisted"];

export function shouldRecordRejection(
  isProduction: boolean,
  isBlocking: boolean,
  reason?: RejectionReason
): boolean {
  if (!isProduction) return true;
  if (isBlocking) return true;
  const isHighFreq = reason !== undefined && HIGH_FREQ_REASONS.includes(reason);
  const rate = isHighFreq
    ? parseFloat(process.env.PIXEL_INGEST_STATS_SAMPLING_HIGH_FREQ ?? "0.001")
    : parseFloat(process.env.PIXEL_INGEST_STATS_SAMPLING ?? "0.01");
  return Math.random() < rate;
}
