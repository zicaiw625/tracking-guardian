

import { logger } from "./logger.server";

type MetricType = "counter" | "gauge" | "histogram";

interface MetricEntry {
    name: string;
    type: MetricType;
    value: number;
    labels: Record<string, string>;
    timestamp: number;
}

interface AggregatedMetric {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
        p50?: number;
    p95?: number;
}

const metrics: MetricEntry[] = [];
const MAX_METRICS_SIZE = 10000;
const AGGREGATION_INTERVAL_MS = 60 * 1000;

const counters: Map<string, number> = new Map();
const gauges: Map<string, number> = new Map();
const histograms: Map<string, number[]> = new Map();

function metricKey(name: string, labels: Record<string, string> = {}): string {
    const labelStr = Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
}

export function incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = metricKey(name, labels);
    const current = counters.get(key) || 0;
    counters.set(key, current + value);

    addMetric(name, "counter", value, labels);
}

export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    gauges.set(key, value);

    addMetric(name, "gauge", value, labels);
}

export function recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    const values = histograms.get(key) || [];
    values.push(value);

    if (values.length > 1000) {
        values.shift();
    }
    histograms.set(key, values);

    addMetric(name, "histogram", value, labels);
}

function addMetric(name: string, type: MetricType, value: number, labels: Record<string, string> = {}): void {
    metrics.push({
        name,
        type,
        value,
        labels,
        timestamp: Date.now(),
    });

    if (metrics.length > MAX_METRICS_SIZE) {
        metrics.splice(0, metrics.length - MAX_METRICS_SIZE);
    }
}

export function getAggregatedMetrics(windowMs: number = 60000): Record<string, AggregatedMetric> {
    const now = Date.now();
    const windowStart = now - windowMs;

    const filtered = metrics.filter(m => m.timestamp >= windowStart);
    const aggregated: Record<string, AggregatedMetric> = {};

    for (const metric of filtered) {
        const key = metricKey(metric.name, metric.labels);
        if (!aggregated[key]) {
            aggregated[key] = {
                count: 0,
                sum: 0,
                min: Infinity,
                max: -Infinity,
                avg: 0,
            };
        }

        const agg = aggregated[key];
        agg.count++;
        agg.sum += metric.value;
        agg.min = Math.min(agg.min, metric.value);
        agg.max = Math.max(agg.max, metric.value);
        agg.avg = agg.sum / agg.count;
    }

    return aggregated;
}

export function getCounters(): Record<string, number> {
    return Object.fromEntries(counters);
}

export function getGauges(): Record<string, number> {
    return Object.fromEntries(gauges);
}

export function getHistogramStats(name: string, labels: Record<string, string> = {}): AggregatedMetric | null {
    const key = metricKey(name, labels);
    const values = histograms.get(key);

    if (!values || values.length === 0) {
        return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

    return {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: values.reduce((a, b) => a + b, 0) / values.length,
                p50,
        p95,
    };
}

export function resetMetrics(): void {
    metrics.length = 0;
    counters.clear();
    gauges.clear();
    histograms.clear();
}

export const appMetrics = {

    httpRequestTotal: (method: string, path: string, status: number) =>
        incrementCounter("http_request_total", { method, path, status: String(status) }),

    httpRequestDuration: (method: string, path: string, durationMs: number) =>
        recordHistogram("http_request_duration_ms", durationMs, { method, path }),

    pixelEventReceived: (shopDomain: string) =>
        incrementCounter("pixel_event_received_total", { shop: shopDomain }),

    pixelEventRejected: (reason: string) =>
        incrementCounter("pixel_event_rejected_total", { reason }),

    webhookProcessed: (topic: string, status: "success" | "failed") =>
        incrementCounter("webhook_processed_total", { topic, status }),

    webhookDuration: (topic: string, durationMs: number) =>
        recordHistogram("webhook_duration_ms", durationMs, { topic }),

    capiEventSent: (platform: string, status: "success" | "failed") =>
        incrementCounter("capi_event_sent_total", { platform, status }),

    capiLatency: (platform: string, latencyMs: number) =>
        recordHistogram("capi_latency_ms", latencyMs, { platform }),

    dbQueryDuration: (operation: string, durationMs: number) =>
        recordHistogram("db_query_duration_ms", durationMs, { operation }),

    rateLimitHit: (endpoint: string) =>
        incrementCounter("rate_limit_hit_total", { endpoint }),

    activeJobs: (count: number) =>
        setGauge("active_jobs", count),

    pendingRetries: (count: number) =>
        setGauge("pending_retries", count),

        pxIngestAccepted: (shopDomain: string) =>
        incrementCounter("px_ingest_accepted_count", { shop: shopDomain }),

    pxValidateFailed: (shopDomain: string, reason: string) =>
        incrementCounter("px_validate_failed_count", { shop: shopDomain, reason }),

    pxDedupDropped: (shopDomain: string, destination: string) =>
        incrementCounter("px_dedup_dropped_count", { shop: shopDomain, destination }),

    pxDestinationOk: (shopDomain: string, destination: string) =>
        incrementCounter("px_destination_ok_count", { shop: shopDomain, destination }),

    pxDestinationFail: (shopDomain: string, destination: string, reason?: string) =>
        incrementCounter("px_destination_fail_count", { shop: shopDomain, destination, reason: reason || "unknown" }),

    pxDestinationLatency: (shopDomain: string, destination: string, latencyMs: number) =>
        recordHistogram("px_destination_latency_ms", latencyMs, { shop: shopDomain, destination }),
};

if (process.env.NODE_ENV === "production") {
    setInterval(() => {
        const aggregated = getAggregatedMetrics(AGGREGATION_INTERVAL_MS);
        const metricsCount = Object.keys(aggregated).length;

        if (metricsCount > 0) {
            logger.info("[METRICS] Aggregated metrics", {
                period_ms: AGGREGATION_INTERVAL_MS,
                metrics_count: metricsCount,
                sample: Object.entries(aggregated).slice(0, 10).map(([k, v]) => ({
                    metric: k,
                    count: v.count,
                    avg: Math.round(v.avg * 100) / 100,
                })),
            });
        }
    }, AGGREGATION_INTERVAL_MS);
}

