import { describe, it, expect } from "vitest";
import { analyzeScriptContent } from "../../app/services/scanner/content-analysis";
import { detectPlatforms, identifyPlatformFromSrc } from "../../app/services/scanner/patterns";
import { calculateRiskScore } from "../../app/services/scanner/risk-assessment";

describe("Scanner Pattern Detection", () => {
    describe("detectPlatforms", () => {
        it("should detect Google Analytics from gtag calls", () => {
            const content = `gtag('config', 'G-XXXXXXXXXX');`;
            const platforms = detectPlatforms(content);
            expect(platforms).toContain("google");
        });
        it("should detect Meta Pixel from fbq calls", () => {
            const content = `fbq('track', 'Purchase', {value: 100});`;
            const platforms = detectPlatforms(content);
            expect(platforms).toContain("meta");
        });
        it("should detect TikTok Pixel from ttq calls", () => {
            const content = `ttq('init', 'PIXEL_ID');`;
            const platforms = detectPlatforms(content);
            expect(platforms).toContain("tiktok");
        });
        it("should detect TikTok from analytics domain", () => {
            const content = `https://analytics.tiktok.com/i18n/pixel/events.js`;
            const platforms = detectPlatforms(content);
            expect(platforms).toContain("tiktok");
        });
        it("should detect multiple platforms in the same content", () => {
            const content = `
                gtag('config', 'G-XXXXXXXXXX');
                fbq('track', 'Purchase');
                https://analytics.tiktok.com/i18n/pixel/events.js
            `;
            const platforms = detectPlatforms(content);
            expect(platforms).toContain("google");
            expect(platforms).toContain("meta");
            expect(platforms).toContain("tiktok");
        });
        it("should return empty array for unknown content", () => {
            const content = "console.log('hello world');";
            const platforms = detectPlatforms(content);
            expect(platforms).toHaveLength(0);
        });
    });
    describe("identifyPlatformFromSrc", () => {
        it("should identify GTM from GTM URL", () => {
            const src = "https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXX";
            const platform = identifyPlatformFromSrc(src);
            expect(platform).toBe("gtm");
        });
        it("should identify Google from GA4 URL", () => {
            const src = "https://www.google-analytics.com/g/collect";
            const platform = identifyPlatformFromSrc(src);
            expect(platform).toBe("google");
        });
        it("should identify Meta from Facebook CDN", () => {
            const src = "https://connect.facebook.net/en_US/fbevents.js";
            const platform = identifyPlatformFromSrc(src);
            expect(platform).toBe("meta");
        });
        it("should identify TikTok from analytics domain", () => {
            const src = "https://analytics.tiktok.com/i18n/pixel/events.js";
            const platform = identifyPlatformFromSrc(src);
            expect(platform).toBe("tiktok");
        });
        it("should return unknown for unrecognized URLs", () => {
            const src = "https://example.com/script.js";
            const platform = identifyPlatformFromSrc(src);
            expect(platform).toBe("unknown");
        });
    });
});

describe("Risk Assessment", () => {
    describe("calculateRiskScore", () => {
        it("should return 0 for empty risk items", () => {
            const score = calculateRiskScore([]);
            expect(score).toBe(0);
        });
        it("should calculate weighted score based on severity", () => {
            const risks = [
                { id: "test1", name: "High Risk", description: "Test", severity: "high" as const, points: 30 },
                { id: "test2", name: "Low Risk", description: "Test", severity: "low" as const, points: 10 },
            ];
            const score = calculateRiskScore(risks);
            expect(score).toBe(25);
        });
        it("should cap score at 100", () => {
            const risks = [
                { id: "test1", name: "Risk 1", description: "Test", severity: "high" as const, points: 50 },
                { id: "test2", name: "Risk 2", description: "Test", severity: "high" as const, points: 50 },
            ];
            const score = calculateRiskScore(risks);
            expect(score).toBeLessThanOrEqual(100);
        });
    });
});

describe("Content Analysis", () => {
    describe("analyzeScriptContent", () => {
        it("should return empty result for empty content", () => {
            const result = analyzeScriptContent("");
            expect(result.identifiedPlatforms).toHaveLength(0);
            expect(result.platformDetails).toHaveLength(0);
            expect(result.risks).toHaveLength(0);
            expect(result.riskScore).toBe(0);
        });
        it("should detect platforms and generate recommendations", () => {
            const content = `
                !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)}}
                fbq('init', '1234567890123456');
                fbq('track', 'PageView');
            `;
            const result = analyzeScriptContent(content);
            expect(result.identifiedPlatforms).toContain("meta");
            expect(result.recommendations.length).toBeGreaterThan(0);
            expect(result.recommendations.some(r => r.includes("Meta"))).toBe(true);
        });
        it("should detect Legacy UA and add high severity risk", () => {
            const content = `
                gtag('config', 'UA-12345-1');
            `;
            const result = analyzeScriptContent(content);
            expect(result.identifiedPlatforms).toContain("google");
            expect(result.risks.some(r => r.id === "legacy_ua")).toBe(true);
        });
        it("should detect inline script tags as a risk", () => {
            const content = `
                <script>
                    gtag('config', 'G-XXXXXXXXXX');
                </script>
            `;
            const result = analyzeScriptContent(content);
            expect(result.risks.some(r => r.id === "inline_script_tags")).toBe(true);
        });
        it("should extract GA4 Measurement IDs", () => {
            const content = `G-ABC1234XYZ`;
            const result = analyzeScriptContent(content);
            expect(result.platformDetails.some(d =>
                d.platform === "google" && d.matchedPattern === "G-ABC1234XYZ"
            )).toBe(true);
        });
    });
});
