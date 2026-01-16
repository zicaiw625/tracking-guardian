import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../app/db.server", () => ({
  default: {
    scanReport: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe("Scanner Service", () => {
  describe("Platform Detection Patterns", () => {
    const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
      google: [
        /gtag\s*\(/i,
        /google-analytics/i,
        /googletagmanager/i,
        /G-[A-Z0-9]{10,}/i,
        /AW-\d{9,}/i,
        /google_conversion/i,
        /gtm\.js/i,
        /UA-\d+-\d+/i,
      ],
      meta: [
        /fbq\s*\(/i,
        /facebook\.net\/.*fbevents/i,
        /connect\.facebook\.net/i,
        /fb-pixel/i,
        /pixel[_-]?id['":\s]+\d{15,16}/i,
      ],
      tiktok: [
        /ttq\s*[.(]/i,
        /tiktok.*pixel/i,
        /analytics\.tiktok\.com/i,
      ],
      bing: [
        /uetq/i,
        /bing.*uet/i,
        /bat\.bing\.com/i,
      ],
      clarity: [
        /clarity\s*\(/i,
        /clarity\.ms/i,
      ],
    };
    function detectPlatforms(content: string): string[] {
      const detected: string[] = [];
      for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            if (!detected.includes(platform)) {
              detected.push(platform);
            }
            break;
          }
        }
      }
      return detected;
    }
    describe("Google Detection", () => {
      it("should detect gtag function calls", () => {
        const content = "gtag('event', 'conversion')";
        expect(detectPlatforms(content)).toContain("google");
      });
      it("should detect GA4 measurement ID", () => {
        const content = "G-1A2B3C4D5E";
        expect(detectPlatforms(content)).toContain("google");
      });
      it("should detect Google Ads conversion ID", () => {
        const content = "AW-123456789";
        expect(detectPlatforms(content)).toContain("google");
      });
      it("should detect GTM script", () => {
        const content = "https://www.googletagmanager.com/gtm.js?id=GTM-ABCDE";
        expect(detectPlatforms(content)).toContain("google");
      });
      it("should detect legacy Universal Analytics", () => {
        const content = "UA-12345-1";
        expect(detectPlatforms(content)).toContain("google");
      });
    });
    describe("Meta/Facebook Detection", () => {
      it("should detect fbq function calls", () => {
        const content = "fbq('track', 'PageView')";
        expect(detectPlatforms(content)).toContain("meta");
      });
      it("should detect Facebook SDK script", () => {
        const content = "https://connect.facebook.net/en_US/fbevents.js";
        expect(detectPlatforms(content)).toContain("meta");
      });
      it("should detect pixel ID in context", () => {
        const content = 'pixel_id: "1234567890123456"';
        expect(detectPlatforms(content)).toContain("meta");
      });
      it("should NOT false positive on random 16-digit numbers", () => {
        const content = "order total: 1234567890123456";
        expect(detectPlatforms(content)).not.toContain("meta");
      });
    });
    describe("TikTok Detection", () => {
      it("should detect ttq function calls", () => {
        const content = "ttq.page()";
        expect(detectPlatforms(content)).toContain("tiktok");
      });
      it("should detect TikTok analytics domain", () => {
        const content = "https://analytics.tiktok.com/i18n/pixel/events.js";
        expect(detectPlatforms(content)).toContain("tiktok");
      });
    });
    describe("Microsoft Bing Detection", () => {
      it("should detect UET tag", () => {
        const content = "window.uetq = window.uetq || []";
        expect(detectPlatforms(content)).toContain("bing");
      });
      it("should detect bat.bing.com", () => {
        const content = "https://bat.bing.com/action/0?ti=123456";
        expect(detectPlatforms(content)).toContain("bing");
      });
    });
    describe("Microsoft Clarity Detection", () => {
      it("should detect clarity function", () => {
        const content = "clarity('set', 'user_id')";
        expect(detectPlatforms(content)).toContain("clarity");
      });
      it("should detect clarity.ms domain", () => {
        const content = "https://www.clarity.ms/tag/abc123";
        expect(detectPlatforms(content)).toContain("clarity");
      });
    });
    describe("Multiple Platform Detection", () => {
      it("should detect multiple platforms in same content", () => {
        const content = `
          gtag('config', 'G-XXXXXXXXXX');
          fbq('track', 'PageView');
          ttq.page();
        `;
        const detected = detectPlatforms(content);
        expect(detected).toContain("google");
        expect(detected).toContain("meta");
        expect(detected).toContain("tiktok");
      });
      it("should not duplicate platform detection", () => {
        const content = `
          gtag('config', 'G-XXXXXXXXXX');
          gtag('event', 'purchase');
          googletagmanager.com/gtm.js
        `;
        const detected = detectPlatforms(content);
        const googleCount = detected.filter((p) => p === "google").length;
        expect(googleCount).toBe(1);
      });
    });
  });
  describe("Risk Score Calculation", () => {
    type RiskSeverity = "high" | "medium" | "low";
    interface RiskItem {
      id: string;
      name: string;
      description: string;
      severity: RiskSeverity;
      points: number;
    }
    const severityWeight: Record<RiskSeverity, number> = {
      high: 1.5,
      medium: 1.0,
      low: 0.5,
    };
    function calculateRiskScore(riskItems: RiskItem[]): number {
      if (riskItems.length === 0) {
        return 0;
      }
      const weightedPoints = riskItems.reduce((sum, item) => {
        const weight = severityWeight[item.severity] || 1.0;
        return sum + item.points * weight;
      }, 0);
      return Math.min(100, Math.round(weightedPoints));
    }
    it("should return 0 for empty risk items", () => {
      expect(calculateRiskScore([])).toBe(0);
    });
    it("should calculate weighted score for high severity", () => {
      const items: RiskItem[] = [
        {
          id: "test",
          name: "Test",
          description: "Test",
          severity: "high",
          points: 20,
        },
      ];
      expect(calculateRiskScore(items)).toBe(30);
    });
    it("should calculate weighted score for medium severity", () => {
      const items: RiskItem[] = [
        {
          id: "test",
          name: "Test",
          description: "Test",
          severity: "medium",
          points: 20,
        },
      ];
      expect(calculateRiskScore(items)).toBe(20);
    });
    it("should calculate weighted score for low severity", () => {
      const items: RiskItem[] = [
        {
          id: "test",
          name: "Test",
          description: "Test",
          severity: "low",
          points: 20,
        },
      ];
      expect(calculateRiskScore(items)).toBe(10);
    });
    it("should cap score at 100", () => {
      const items: RiskItem[] = [
        { id: "1", name: "A", description: "", severity: "high", points: 50 },
        { id: "2", name: "B", description: "", severity: "high", points: 50 },
        { id: "3", name: "C", description: "", severity: "high", points: 50 },
      ];
      expect(calculateRiskScore(items)).toBe(100);
    });
    it("should handle mixed severities", () => {
      const items: RiskItem[] = [
        { id: "1", name: "A", description: "", severity: "high", points: 30 },
        { id: "2", name: "B", description: "", severity: "medium", points: 20 },
        { id: "3", name: "C", description: "", severity: "low", points: 10 },
      ];
      expect(calculateRiskScore(items)).toBe(70);
    });
  });
});
