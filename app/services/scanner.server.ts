import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import type { ScanResult, RiskItem, ScriptTag, CheckoutConfig, RiskSeverity } from "../types";

// Platform detection patterns
// Each platform has patterns that uniquely identify it
// Patterns are tested in order - more specific patterns first
const PLATFORM_PATTERNS: Record<string, RegExp[]> = {
  google: [
    /gtag\s*\(/i,                    // gtag() function call
    /google-analytics/i,            // GA script reference
    /googletagmanager/i,            // GTM script reference
    /G-[A-Z0-9]{10,}/i,            // GA4 Measurement ID (G-XXXXXXXXXX)
    /AW-\d{9,}/i,                   // Google Ads conversion ID
    /google_conversion/i,           // Legacy conversion tracking
    /gtm\.js/i,                     // GTM script file
    /UA-\d+-\d+/i,                  // Universal Analytics (legacy)
  ],
  meta: [
    /fbq\s*\(/i,                    // Meta Pixel function call
    /facebook\.net\/.*fbevents/i,  // Facebook events script
    /connect\.facebook\.net/i,      // Facebook connect script
    /fb-pixel/i,                    // FB pixel reference
    // Meta Pixel IDs are 15-16 digits, but require context to avoid false positives
    /pixel[_\-]?id['":\s]+\d{15,16}/i,
  ],
  tiktok: [
    /ttq\s*\(/i,                    // TikTok Pixel function call
    /tiktok.*pixel/i,               // TikTok pixel reference
    /analytics\.tiktok\.com/i,      // TikTok analytics domain
  ],
  bing: [
    /uetq/i,                        // UET tag queue
    /bing.*uet/i,                   // Bing UET reference
    /bat\.bing\.com/i,              // Bing bat.js domain
  ],
  clarity: [
    /clarity\s*\(/i,                // Clarity function call
    /clarity\.ms/i,                 // Clarity domain
  ],
  pinterest: [
    /pintrk/i,                      // Pinterest tag
    /pinimg\.com.*tag/i,            // Pinterest tag image
  ],
  snapchat: [
    /snaptr/i,                      // Snapchat pixel
    /sc-static\.net.*scevent/i,     // Snapchat event script
  ],
  twitter: [
    /twq\s*\(/i,                    // Twitter pixel function
    /twitter.*pixel/i,              // Twitter pixel reference
    /static\.ads-twitter\.com/i,    // Twitter ads domain
  ],
};

// Risk assessment rules
interface RiskRule {
  id: string;
  name: string;
  description: string;
  severity: RiskSeverity;
  points: number;
}

const RISK_RULES: RiskRule[] = [
  {
    id: "deprecated_script_tag",
    name: "已废弃的 ScriptTag",
    description: "使用了即将被关闭的 ScriptTag API",
    severity: "high",
    points: 30,
  },
  {
    id: "additional_scripts",
    name: "Additional Scripts",
    description: "使用了即将变为只读的 Additional Scripts",
    severity: "high",
    points: 30,
  },
  {
    id: "inline_tracking",
    name: "内联追踪代码",
    description: "直接在页面中嵌入追踪代码，不使用 Shopify 像素 API",
    severity: "medium",
    points: 20,
  },
  {
    id: "no_server_side",
    name: "缺少服务端追踪",
    description: "仅依赖客户端追踪，容易受隐私工具影响",
    severity: "low",
    points: 10,
  },
  {
    id: "outdated_pixel_version",
    name: "过期的像素版本",
    description: "使用了旧版本的追踪像素代码",
    severity: "medium",
    points: 15,
  },
];

// Re-export types from types module
export type { ScanResult, RiskItem } from "../types";

// Error tracking for scan
interface ScanError {
  stage: string;
  message: string;
  timestamp: Date;
}

export async function scanShopTracking(
  admin: AdminApiContext,
  shopId: string
): Promise<ScanResult> {
  const errors: ScanError[] = [];
  const result: ScanResult = {
    scriptTags: [],
    additionalScripts: null,
    checkoutConfig: null,
    identifiedPlatforms: [],
    riskItems: [],
    riskScore: 0,
  };

  console.log(`Starting scan for shop ${shopId}`);

  // 1. Fetch ScriptTags using REST API
  try {
    const scriptTagsResponse = await admin.rest.get({
      path: "script_tags",
    });
    const body = scriptTagsResponse.body as { script_tags?: ScriptTag[] } | null;
    result.scriptTags = body?.script_tags || [];
    console.log(`Found ${result.scriptTags.length} script tags`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching script tags:", errorMessage);
    errors.push({
      stage: "script_tags",
      message: errorMessage,
      timestamp: new Date(),
    });
  }

  // 2. Fetch checkout configuration using GraphQL
  try {
    const checkoutResponse = await admin.graphql(
      `#graphql
      query GetCheckoutConfig {
        shop {
          checkoutApiSupported
          features {
            storefront
          }
        }
      }
    `
    );
    const checkoutData = await checkoutResponse.json();
    result.checkoutConfig = checkoutData.data?.shop as CheckoutConfig;
    console.log(`Checkout config fetched successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching checkout config:", errorMessage);
    errors.push({
      stage: "checkout_config",
      message: errorMessage,
      timestamp: new Date(),
    });
  }

  // 3. Analyze scripts for platform detection
  const allScriptContent = collectScriptContent(result);
  result.identifiedPlatforms = detectPlatforms(allScriptContent);
  console.log(`Identified platforms: ${result.identifiedPlatforms.join(", ") || "none"}`);

  // 4. Assess risks
  result.riskItems = assessRisks(result);
  result.riskScore = calculateRiskScore(result.riskItems);
  console.log(`Risk assessment complete: score=${result.riskScore}, items=${result.riskItems.length}`);

  // 5. Save scan report to database
  try {
    await saveScanReport(shopId, result, errors.length > 0 ? JSON.stringify(errors) : null);
    console.log(`Scan report saved for shop ${shopId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error saving scan report:", errorMessage);
    throw new Error(`Failed to save scan report: ${errorMessage}`);
  }

  return result;
}

function collectScriptContent(result: ScanResult): string {
  let content = "";

  // Collect from script tags
  for (const tag of result.scriptTags) {
    content += ` ${tag.src || ""} ${tag.event || ""}`;
  }

  // Collect from additional scripts if available
  if (result.additionalScripts) {
    if (typeof result.additionalScripts === "string") {
      content += ` ${result.additionalScripts}`;
    } else if (typeof result.additionalScripts === "object") {
      content += ` ${JSON.stringify(result.additionalScripts)}`;
    }
  }

  return content;
}

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

function assessRisks(result: ScanResult): RiskItem[] {
  const risks: RiskItem[] = [];

  // Check for deprecated script tags
  if (result.scriptTags.length > 0) {
    for (const tag of result.scriptTags) {
      // Detect which platform this script tag is for
      let platform = "unknown";
      const src = tag.src || "";
      for (const [p, patterns] of Object.entries(PLATFORM_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(src)) {
            platform = p;
            break;
          }
        }
        if (platform !== "unknown") break;
      }

      risks.push({
        id: "deprecated_script_tag",
        name: "已废弃的 ScriptTag",
        description: `ScriptTag API 即将被关闭`,
        severity: "high",
        points: 30,
        details: `Script URL: ${src}`,
        platform,
      });
    }
  }

  // Check if using old tracking methods without web pixels
  if (result.identifiedPlatforms.length > 0 && result.scriptTags.length > 0) {
    risks.push({
      id: "inline_tracking",
      name: "内联追踪代码",
      description: "检测到使用旧的追踪方式，建议迁移到 Shopify Web Pixel",
      severity: "medium",
      points: 20,
      details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
    });
  }

  // Recommend server-side tracking
  if (result.identifiedPlatforms.length > 0) {
    risks.push({
      id: "no_server_side",
      name: "建议启用服务端追踪",
      description: "仅依赖客户端追踪可能导致 15-30% 的转化丢失",
      severity: "low",
      points: 10,
      details: "建议配置 Conversion API 以提高追踪准确性",
    });
  }

  return risks;
}

/**
 * Calculate overall risk score from risk items
 * Score is 0-100, weighted by severity
 */
function calculateRiskScore(riskItems: RiskItem[]): number {
  if (riskItems.length === 0) {
    return 0;
  }
  
  // Severity weights
  const severityWeight: Record<RiskSeverity, number> = {
    high: 1.5,
    medium: 1.0,
    low: 0.5,
  };
  
  // Calculate weighted points
  const weightedPoints = riskItems.reduce((sum, item) => {
    const weight = severityWeight[item.severity] || 1.0;
    return sum + item.points * weight;
  }, 0);
  
  // Cap at 100
  return Math.min(100, Math.round(weightedPoints));
}

async function saveScanReport(
  shopId: string,
  result: ScanResult,
  errorMessage: string | null = null
): Promise<void> {
  await prisma.scanReport.create({
    data: {
      shopId,
      scriptTags: JSON.parse(JSON.stringify(result.scriptTags)),
      additionalScripts: result.additionalScripts ? JSON.parse(JSON.stringify(result.additionalScripts)) : undefined,
      checkoutConfig: result.checkoutConfig ? JSON.parse(JSON.stringify(result.checkoutConfig)) : undefined,
      identifiedPlatforms: result.identifiedPlatforms,
      riskItems: JSON.parse(JSON.stringify(result.riskItems)),
      riskScore: result.riskScore,
      status: errorMessage ? "completed_with_errors" : "completed",
      errorMessage,
      completedAt: new Date(),
    },
  });
}

export async function getScanHistory(shopId: string, limit = 10) {
  return prisma.scanReport.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

