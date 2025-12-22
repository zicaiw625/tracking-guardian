/**
 * Metrics Collector
 * 
 * A simple in-memory metrics collector for application monitoring.
 * This can be extended to send metrics to external APM services like:
 * - Sentry
 * - Datadog
 * - New Relic
 * - Prometheus/Grafana
 * 
 * Currently stores metrics in memory with periodic aggregation.
 * In production, consider using a dedicated APM service.
 */

import { logger } from "./logger.server";

// Metric types
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
}

// In-memory storage for metrics
const metrics: MetricEntry[] = [];
const MAX_METRICS_SIZE = 10000;
const AGGREGATION_INTERVAL_MS = 60 * 1000; // 1 minute

// Counters for specific metrics
const counters: Map<string, number> = new Map();
const gauges: Map<string, number> = new Map();
const histograms: Map<string, number[]> = new Map();

/**
 * Generate a metric key from name and labels
 */
function metricKey(name: string, labels: Record<string, string> = {}): string {
    const labelStr = Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    return labelStr ? `${name}{${labelStr}}` : name;
}

/**
 * Increment a counter metric
 */
export function incrementCounter(name: string, labels: Record<string, string> = {}, value = 1): void {
    const key = metricKey(name, labels);
    const current = counters.get(key) || 0;
    counters.set(key, current + value);
    
    // Also store as raw metric for aggregation
    addMetric(name, "counter", value, labels);
}

/**
 * Set a gauge metric
 */
export function setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    gauges.set(key, value);
    
    addMetric(name, "gauge", value, labels);
}

/**
 * Record a histogram value (e.g., latency)
 */
export function recordHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    const values = histograms.get(key) || [];
    values.push(value);
    
    // Keep only last 1000 values per histogram
    if (values.length > 1000) {
        values.shift();
    }
    histograms.set(key, values);
    
    addMetric(name, "histogram", value, labels);
}

/**
 * Add a raw metric entry
 */
function addMetric(name: string, type: MetricType, value: number, labels: Record<string, string> = {}): void {
    metrics.push({
        name,
        type,
        value,
        labels,
        timestamp: Date.now(),
    });
    
    // Prevent memory leak
    if (metrics.length > MAX_METRICS_SIZE) {
        metrics.splice(0, metrics.length - MAX_METRICS_SIZE);
    }
}

/**
 * Get aggregated metrics for a time window
 */
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

/**
 * Get current counter values
 */
export function getCounters(): Record<string, number> {
    return Object.fromEntries(counters);
}

/**
 * Get current gauge values
 */
export function getGauges(): Record<string, number> {
    return Object.fromEntries(gauges);
}

/**
 * Get histogram statistics
 */
export function getHistogramStats(name: string, labels: Record<string, string> = {}): AggregatedMetric | null {
    const key = metricKey(name, labels);
    const values = histograms.get(key);
    
    if (!values || values.length === 0) {
        return null;
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    return {
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: values.reduce((a, b) => a + b, 0) / values.length,
    };
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
    metrics.length = 0;
    counters.clear();
    gauges.clear();
    histograms.clear();
}

/**
 * Pre-defined metrics for the application
 */
export const appMetrics = {
    // HTTP request metrics
    httpRequestTotal: (method: string, path: string, status: number) =>
        incrementCounter("http_request_total", { method, path, status: String(status) }),
    
    httpRequestDuration: (method: string, path: string, durationMs: number) =>
        recordHistogram("http_request_duration_ms", durationMs, { method, path }),
    
    // Pixel event metrics
    pixelEventReceived: (shopDomain: string) =>
        incrementCounter("pixel_event_received_total", { shop: shopDomain }),
    
    pixelEventRejected: (reason: string) =>
        incrementCounter("pixel_event_rejected_total", { reason }),
    
    // Webhook metrics
    webhookProcessed: (topic: string, status: "success" | "failed") =>
        incrementCounter("webhook_processed_total", { topic, status }),
    
    webhookDuration: (topic: string, durationMs: number) =>
        recordHistogram("webhook_duration_ms", durationMs, { topic }),
    
    // CAPI metrics
    capiEventSent: (platform: string, status: "success" | "failed") =>
        incrementCounter("capi_event_sent_total", { platform, status }),
    
    capiLatency: (platform: string, latencyMs: number) =>
        recordHistogram("capi_latency_ms", latencyMs, { platform }),
    
    // Database metrics
    dbQueryDuration: (operation: string, durationMs: number) =>
        recordHistogram("db_query_duration_ms", durationMs, { operation }),
    
    // Rate limiting
    rateLimitHit: (endpoint: string) =>
        incrementCounter("rate_limit_hit_total", { endpoint }),
    
    // Active connections/jobs
    activeJobs: (count: number) =>
        setGauge("active_jobs", count),
    
    pendingRetries: (count: number) =>
        setGauge("pending_retries", count),
};

// Log aggregated metrics periodically in production
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

