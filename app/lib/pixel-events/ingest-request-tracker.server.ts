export interface IngestRequestRecord {
  requestId?: string;
  shopDomain: string;
  method: string;
  status: number;
  durationMs: number;
  timestamp: number;
}

export interface IngestRequestStats {
  totalRequests: number;
  optionsRequests: number;
  postRequests: number;
  optionsRatio: number;
  error4xx: number;
  error5xx: number;
  avgLatencyMs: number;
}

class IngestRequestTracker {
  private records: IngestRequestRecord[] = [];
  private readonly maxRecords = 5000;
  private readonly retentionMs = 24 * 60 * 60 * 1000;

  record(entry: IngestRequestRecord): void {
    this.records.push(entry);
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
    this.cleanup();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    this.records = this.records.filter((record) => record.timestamp >= cutoff);
  }

  getStats(shopDomain?: string, hours = 24): IngestRequestStats {
    this.cleanup();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const filtered = this.records.filter((record) => {
      if (record.timestamp < cutoff) {
        return false;
      }
      if (!shopDomain) {
        return true;
      }
      return record.shopDomain === shopDomain;
    });
    const optionsRequests = filtered.filter((record) => record.method === "OPTIONS").length;
    const postRequests = filtered.filter((record) => record.method === "POST").length;
    const error4xx = filtered.filter((record) => record.status >= 400 && record.status < 500).length;
    const error5xx = filtered.filter((record) => record.status >= 500).length;
    const avgLatencyMs = filtered.length > 0
      ? filtered.reduce((sum, record) => sum + record.durationMs, 0) / filtered.length
      : 0;
    return {
      totalRequests: filtered.length,
      optionsRequests,
      postRequests,
      optionsRatio: filtered.length > 0 ? optionsRequests / filtered.length : 0,
      error4xx,
      error5xx,
      avgLatencyMs,
    };
  }
}

export const ingestRequestTracker = new IngestRequestTracker();
