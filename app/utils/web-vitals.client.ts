import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

export interface WebVitalsMetric {
  name: string;
  value: number;
  id: string;
  delta: number;
  rating: "good" | "needs-improvement" | "poor";
  navigationType: string;
  url: string;
  timestamp: number;
}

function getRating(metric: Metric): "good" | "needs-improvement" | "poor" {
  const thresholds: Record<string, { good: number; poor: number }> = {
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    INP: { good: 200, poor: 500 },
    LCP: { good: 2500, poor: 4000 },
    TTFB: { good: 800, poor: 1800 },
  };

  const threshold = thresholds[metric.name];
  if (!threshold) return "good";

  if (metric.value <= threshold.good) return "good";
  if (metric.value <= threshold.poor) return "needs-improvement";
  return "poor";
}

function sendToAnalytics(metric: WebVitalsMetric) {
  const body = JSON.stringify(metric);

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/performance", body);
  } else {
    fetch("/api/performance", {
      body,
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
      },
    }).catch((err) => {
      console.error("Failed to send performance metric:", err);
    });
  }
}

export function reportWebVitals() {
  if (typeof window === "undefined") return;

  const reportMetric = (metric: Metric) => {
    const webVitalsMetric: WebVitalsMetric = {
      name: metric.name,
      value: metric.value,
      id: metric.id,
      delta: metric.delta,
      rating: getRating(metric),
      navigationType: metric.navigationType,
      url: window.location.href,
      timestamp: Date.now(),
    };

    sendToAnalytics(webVitalsMetric);
  };

  onCLS(reportMetric);
  onFCP(reportMetric);
  onINP(reportMetric);
  onLCP(reportMetric);
  onTTFB(reportMetric);
}

