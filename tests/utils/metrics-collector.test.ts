import { describe, it, expect, beforeEach } from "vitest";
import {
    incrementCounter,
    setGauge,
    recordHistogram,
    getCounters,
    getGauges,
    getHistogramStats,
    getAggregatedMetrics,
    resetMetrics,
    appMetrics,
} from "../../app/utils/metrics-collector";

describe("Metrics Collector", () => {
    beforeEach(() => {
        resetMetrics();
    });

    describe("Counter", () => {
        it("should increment counter", () => {
            incrementCounter("test_counter");
            incrementCounter("test_counter");

            const counters = getCounters();
            expect(counters["test_counter"]).toBe(2);
        });

        it("should increment counter with labels", () => {
            incrementCounter("http_requests", { method: "GET", status: "200" });
            incrementCounter("http_requests", { method: "POST", status: "201" });
            incrementCounter("http_requests", { method: "GET", status: "200" });

            const counters = getCounters();
            expect(counters["http_requests{method=GET,status=200}"]).toBe(2);
            expect(counters["http_requests{method=POST,status=201}"]).toBe(1);
        });

        it("should increment counter by custom value", () => {
            incrementCounter("bytes_sent", {}, 1024);
            incrementCounter("bytes_sent", {}, 512);

            const counters = getCounters();
            expect(counters["bytes_sent"]).toBe(1536);
        });
    });

    describe("Gauge", () => {
        it("should set gauge value", () => {
            setGauge("temperature", 25);

            const gauges = getGauges();
            expect(gauges["temperature"]).toBe(25);
        });

        it("should overwrite gauge value", () => {
            setGauge("active_connections", 10);
            setGauge("active_connections", 15);

            const gauges = getGauges();
            expect(gauges["active_connections"]).toBe(15);
        });

        it("should support gauge with labels", () => {
            setGauge("queue_size", 5, { queue: "main" });
            setGauge("queue_size", 3, { queue: "retry" });

            const gauges = getGauges();
            expect(gauges["queue_size{queue=main}"]).toBe(5);
            expect(gauges["queue_size{queue=retry}"]).toBe(3);
        });
    });

    describe("Histogram", () => {
        it("should record histogram values", () => {
            recordHistogram("request_latency", 100);
            recordHistogram("request_latency", 150);
            recordHistogram("request_latency", 200);

            const stats = getHistogramStats("request_latency");
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(3);
            expect(stats!.min).toBe(100);
            expect(stats!.max).toBe(200);
            expect(stats!.avg).toBe(150);
        });

        it("should calculate correct statistics", () => {
            const values = [10, 20, 30, 40, 50];
            for (const v of values) {
                recordHistogram("test_histogram", v);
            }

            const stats = getHistogramStats("test_histogram");
            expect(stats!.count).toBe(5);
            expect(stats!.sum).toBe(150);
            expect(stats!.min).toBe(10);
            expect(stats!.max).toBe(50);
            expect(stats!.avg).toBe(30);
        });

        it("should return null for non-existent histogram", () => {
            const stats = getHistogramStats("non_existent");
            expect(stats).toBeNull();
        });
    });

    describe("Aggregation", () => {
        it("should aggregate metrics within time window", () => {
            incrementCounter("test_agg", {}, 5);
            incrementCounter("test_agg", {}, 3);

            const aggregated = getAggregatedMetrics(60000);
            expect(Object.keys(aggregated).length).toBeGreaterThan(0);
        });
    });

    describe("App Metrics Helpers", () => {
        it("should track HTTP request metrics", () => {
            appMetrics.httpRequestTotal("GET", "/api/health", 200);
            appMetrics.httpRequestTotal("POST", "/api/data", 201);

            const counters = getCounters();
            expect(counters["http_request_total{method=GET,path=/api/health,status=200}"]).toBe(1);
            expect(counters["http_request_total{method=POST,path=/api/data,status=201}"]).toBe(1);
        });

        it("should track HTTP request duration", () => {
            appMetrics.httpRequestDuration("GET", "/api/health", 50);
            appMetrics.httpRequestDuration("GET", "/api/health", 100);

            const stats = getHistogramStats("http_request_duration_ms", { method: "GET", path: "/api/health" });
            expect(stats).not.toBeNull();
            expect(stats!.count).toBe(2);
            expect(stats!.avg).toBe(75);
        });

        it("should track pixel events", () => {
            appMetrics.pixelEventReceived("test-shop.myshopify.com");
            appMetrics.pixelEventReceived("test-shop.myshopify.com");

            const counters = getCounters();
            expect(counters["pixel_event_received_total{shop=test-shop.myshopify.com}"]).toBe(2);
        });

        it("should track CAPI events", () => {
            appMetrics.capiEventSent("meta", "success");
            appMetrics.capiEventSent("meta", "failed");
            appMetrics.capiLatency("meta", 250);

            const counters = getCounters();
            expect(counters["capi_event_sent_total{platform=meta,status=success}"]).toBe(1);
            expect(counters["capi_event_sent_total{platform=meta,status=failed}"]).toBe(1);
        });

        it("should track active jobs gauge", () => {
            appMetrics.activeJobs(5);
            appMetrics.activeJobs(3);

            const gauges = getGauges();
            expect(gauges["active_jobs"]).toBe(3);
        });
    });

    describe("Reset", () => {
        it("should reset all metrics", () => {
            incrementCounter("counter1");
            setGauge("gauge1", 10);
            recordHistogram("hist1", 100);

            resetMetrics();

            expect(getCounters()).toEqual({});
            expect(getGauges()).toEqual({});
            expect(getHistogramStats("hist1")).toBeNull();
        });
    });
});
