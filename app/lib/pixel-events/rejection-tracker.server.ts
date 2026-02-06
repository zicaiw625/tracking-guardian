
export type RejectionReason =
  | "invalid_timestamp"
  | "timestamp_missing"
  | "origin_not_allowlisted"
  | "invalid_key"
  | "no_ingestion_key"
  | "invalid_payload"
  | "rate_limit_exceeded"
  | "shop_not_found"
  | "content_type_invalid"
  | "body_too_large"
  | "invalid_json"
  | "empty_events"
  | "shop_domain_mismatch"
  | "unknown";

interface RejectionRecord {
  requestId: string;
  shopDomain: string;
  reason: RejectionReason;
  originType?: string;
  timestamp: number;
}

class RejectionTracker {
  private records: RejectionRecord[] = [];
  private readonly maxRecords = 1000;
  private readonly retentionMs = 24 * 60 * 60 * 1000;

  record(rejection: RejectionRecord): void {
    this.records.push(rejection);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    this.cleanup();
  }

  private cleanup(): void {
    const now = Date.now();
    this.records = this.records.filter(
      (r) => now - r.timestamp < this.retentionMs
    );
  }

  getRecentRejections(shopDomain?: string, limit = 100): RejectionRecord[] {
    this.cleanup();
    let filtered = this.records;
    if (shopDomain) {
      filtered = filtered.filter((r) => r.shopDomain === shopDomain);
    }
    return filtered
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  getRejectionStats(shopDomain?: string, hours = 24): {
    reason: RejectionReason;
    count: number;
    percentage: number;
  }[] {
    this.cleanup();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let filtered = this.records.filter((r) => r.timestamp >= cutoff);
    if (shopDomain) {
      filtered = filtered.filter((r) => r.shopDomain === shopDomain);
    }

    const reasonCounts = new Map<RejectionReason, number>();
    for (const record of filtered) {
      reasonCounts.set(
        record.reason,
        (reasonCounts.get(record.reason) || 0) + 1
      );
    }

    const total = filtered.length;
    return Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  getRejectionRate(
    reason: RejectionReason,
    shopDomain?: string,
    windowMs = 60000
  ): number {
    this.cleanup();
    const cutoff = Date.now() - windowMs;
    let filtered = this.records.filter(
      (r) => r.timestamp >= cutoff && r.reason === reason
    );
    if (shopDomain) {
      filtered = filtered.filter((r) => r.shopDomain === shopDomain);
    }
    return filtered.length;
  }
}

export const rejectionTracker = new RejectionTracker();
