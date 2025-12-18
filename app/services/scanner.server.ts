import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import type { ScanResult, RiskItem, ScriptTag, CheckoutConfig, RiskSeverity } from "../types";

// ==========================================
// Types for enhanced scan
// ==========================================

export interface WebPixelInfo {
  id: string;
  settings: string | null;
}

export interface MigrationAction {
  type: "delete_script_tag" | "configure_pixel" | "remove_duplicate" | "enable_capi";
  priority: "high" | "medium" | "low";
  platform?: string;
  title: string;
  description: string;
  scriptTagId?: number;
  deadline?: string;
}

export interface EnhancedScanResult extends ScanResult {
  webPixels: WebPixelInfo[];
  duplicatePixels: Array<{ platform: string; count: number; ids: string[] }>;
  migrationActions: MigrationAction[];
}

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

/**
 * Risk assessment rules
 * 
 * NOTE on Additional Scripts:
 * We CANNOT automatically read Additional Scripts content via API.
 * The Shopify Admin API does not provide access to checkout.liquid Additional Scripts.
 * 
 * For Additional Scripts analysis, users should:
 * 1. Copy their Additional Scripts content from Shopify Admin → Settings → Checkout
 * 2. Use our "脚本分析器" feature (if implemented) to analyze the pasted content
 * 3. Follow our migration guide to move scripts to Web Pixels
 */
const RISK_RULES: RiskRule[] = [
  {
    id: "deprecated_script_tag",
    name: "已废弃的 ScriptTag",
    description: "使用了即将被关闭的 ScriptTag API",
    severity: "high",
    points: 30,
  },
  // REMOVED: additional_scripts rule - we cannot detect this automatically
  // The old rule incorrectly suggested we could scan Additional Scripts
  {
    id: "inline_tracking",
    name: "内联追踪代码",
    description: "检测到 ScriptTag 中使用传统追踪方式，建议迁移到 Web Pixel",
    severity: "medium",
    points: 20,
  },
  {
    id: "no_server_side",
    name: "建议启用服务端追踪",
    description: "仅依赖客户端追踪可能导致 15-30% 的转化丢失",
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

/**
 * Enhanced scan that provides actionable migration recommendations
 */
export async function scanShopTracking(
  admin: AdminApiContext,
  shopId: string
): Promise<EnhancedScanResult> {
  const errors: ScanError[] = [];
  const result: EnhancedScanResult = {
    scriptTags: [],
    additionalScripts: null, // NOTE: Cannot be read via API - documented limitation
    checkoutConfig: null,
    identifiedPlatforms: [],
    riskItems: [],
    riskScore: 0,
    webPixels: [],
    duplicatePixels: [],
    migrationActions: [],
  };

  console.log(`Starting enhanced scan for shop ${shopId}`);

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

  // 3. Fetch Web Pixels (App Pixels) using GraphQL
  try {
    const webPixelsResponse = await admin.graphql(
      `#graphql
      query GetWebPixels {
        webPixels(first: 50) {
          edges {
            node {
              id
              settings
            }
          }
        }
      }
    `
    );
    const webPixelsData = await webPixelsResponse.json();
    const webPixelEdges = webPixelsData.data?.webPixels?.edges || [];
    result.webPixels = webPixelEdges.map((edge: { node: WebPixelInfo }) => ({
      id: edge.node.id,
      settings: edge.node.settings,
    }));
    console.log(`Found ${result.webPixels.length} web pixels`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching web pixels:", errorMessage);
    errors.push({
      stage: "web_pixels",
      message: errorMessage,
      timestamp: new Date(),
    });
  }

  // 4. Analyze scripts for platform detection
  const allScriptContent = collectScriptContent(result);
  result.identifiedPlatforms = detectPlatforms(allScriptContent);
  console.log(`Identified platforms: ${result.identifiedPlatforms.join(", ") || "none"}`);

  // 5. Detect duplicate pixels
  result.duplicatePixels = detectDuplicatePixels(result);
  console.log(`Duplicate pixels found: ${result.duplicatePixels.length}`);

  // 6. Assess risks
  result.riskItems = assessRisks(result);
  result.riskScore = calculateRiskScore(result.riskItems);
  console.log(`Risk assessment complete: score=${result.riskScore}, items=${result.riskItems.length}`);

  // 7. Generate actionable migration recommendations
  result.migrationActions = generateMigrationActions(result);
  console.log(`Generated ${result.migrationActions.length} migration actions`);

  // 8. Save scan report to database
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

/**
 * Detect duplicate pixels (same platform configured multiple times)
 */
function detectDuplicatePixels(result: EnhancedScanResult): Array<{ platform: string; count: number; ids: string[] }> {
  const duplicates: Array<{ platform: string; count: number; ids: string[] }> = [];
  
  // Count pixels per platform from ScriptTags
  const platformCounts: Record<string, string[]> = {};
  
  for (const tag of result.scriptTags) {
    const src = tag.src || "";
    for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(src)) {
          if (!platformCounts[platform]) {
            platformCounts[platform] = [];
          }
          platformCounts[platform].push(`scripttag_${tag.id}`);
          break;
        }
      }
    }
  }
  
  // Also check web pixels settings for platform IDs
  for (const pixel of result.webPixels) {
    if (pixel.settings) {
      try {
        const settings = typeof pixel.settings === "string" 
          ? JSON.parse(pixel.settings) 
          : pixel.settings;
        
        // Check for common platform ID patterns in settings
        for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
          if (typeof value === "string") {
            if (/^G-[A-Z0-9]+$/.test(value) || /^AW-\d+$/.test(value)) {
              if (!platformCounts["google"]) platformCounts["google"] = [];
              platformCounts["google"].push(`webpixel_${pixel.id}_${key}`);
            } else if (/^\d{15,16}$/.test(value)) {
              if (!platformCounts["meta"]) platformCounts["meta"] = [];
              platformCounts["meta"].push(`webpixel_${pixel.id}_${key}`);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  
  // Report duplicates
  for (const [platform, ids] of Object.entries(platformCounts)) {
    if (ids.length > 1) {
      duplicates.push({ platform, count: ids.length, ids });
    }
  }
  
  return duplicates;
}

/**
 * Generate actionable migration recommendations
 */
function generateMigrationActions(result: EnhancedScanResult): MigrationAction[] {
  const actions: MigrationAction[] = [];
  
  // Action 1: Delete deprecated ScriptTags
  // ScriptTag API deadline: August 2025 (estimated based on Shopify announcements)
  for (const tag of result.scriptTags) {
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
    
    actions.push({
      type: "delete_script_tag",
      priority: "high",
      platform,
      title: `删除 ScriptTag: ${platform}`,
      description: `ScriptTag API 将于 2025 年 8 月关闭。请先配置 Web Pixel，然后删除此 ScriptTag。`,
      scriptTagId: tag.id,
      deadline: "2025-08-01",
    });
  }
  
  // Action 2: Configure pixels for detected platforms without web pixel
  const configuredPlatforms = new Set<string>();
  for (const pixel of result.webPixels) {
    if (pixel.settings) {
      try {
        const settings = typeof pixel.settings === "string" 
          ? JSON.parse(pixel.settings) 
          : pixel.settings;
        
        // Check what platforms are configured
        for (const [, value] of Object.entries(settings as Record<string, unknown>)) {
          if (typeof value === "string") {
            if (/^G-[A-Z0-9]+$/.test(value) || /^AW-\d+$/.test(value)) {
              configuredPlatforms.add("google");
            } else if (/^\d{15,16}$/.test(value)) {
              configuredPlatforms.add("meta");
            } else if (/^[A-Z0-9]{20,}$/i.test(value)) {
              configuredPlatforms.add("tiktok");
            }
          }
        }
      } catch {
        // Ignore
      }
    }
  }
  
  for (const platform of result.identifiedPlatforms) {
    if (!configuredPlatforms.has(platform)) {
      actions.push({
        type: "configure_pixel",
        priority: "medium",
        platform,
        title: `配置 ${platform.charAt(0).toUpperCase() + platform.slice(1)} Web Pixel`,
        description: `检测到 ${platform} 追踪代码，但尚未配置 Web Pixel。建议使用我们的迁移工具进行配置。`,
      });
    }
  }
  
  // Action 3: Remove duplicate pixels
  for (const dup of result.duplicatePixels) {
    actions.push({
      type: "remove_duplicate",
      priority: "medium",
      platform: dup.platform,
      title: `清理重复的 ${dup.platform} 像素`,
      description: `检测到 ${dup.count} 个 ${dup.platform} 像素配置，可能导致重复追踪。建议只保留一个。`,
    });
  }
  
  // Action 4: Enable CAPI for conversion accuracy
  const hasCAPIConfigured = result.webPixels.some(p => {
    if (!p.settings) return false;
    try {
      const settings = typeof p.settings === "string" ? JSON.parse(p.settings) : p.settings;
      return (settings as Record<string, unknown>).backend_url;
    } catch {
      return false;
    }
  });
  
  if (!hasCAPIConfigured && result.identifiedPlatforms.length > 0) {
    actions.push({
      type: "enable_capi",
      priority: "low",
      title: "启用服务端转化追踪 (CAPI)",
      description: "启用 Conversions API 可将追踪准确率提高 15-30%，不受广告拦截器影响。",
    });
  }
  
  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

function collectScriptContent(result: EnhancedScanResult): string {
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

function assessRisks(result: EnhancedScanResult): RiskItem[] {
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

