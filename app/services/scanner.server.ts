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

// GraphQL edge type for pagination
interface GraphQLEdge<T> {
  node: T;
  cursor: string;
}

interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/**
 * P2-2: Fetch all ScriptTags with pagination
 * Handles stores with more than 100 script tags
 */
async function fetchAllScriptTags(admin: AdminApiContext): Promise<ScriptTag[]> {
  const allTags: ScriptTag[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query GetScriptTags($cursor: String) {
        scriptTags(first: 100, after: $cursor) {
          edges {
            node {
              id
              src
              displayScope
              cache
              createdAt
              updatedAt
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
      { variables: { cursor } }
    );

    const data = await response.json();
    const edges = data.data?.scriptTags?.edges || [];
    const pageInfo: GraphQLPageInfo = data.data?.scriptTags?.pageInfo || { hasNextPage: false, endCursor: null };

    // Transform and add to results
    for (const edge of edges as GraphQLEdge<{
      id: string;
      src: string;
      displayScope: string;
      cache: boolean;
      createdAt: string;
      updatedAt: string;
    }>[]) {
      const gidMatch = edge.node.id.match(/ScriptTag\/(\d+)/);
      const numericId = gidMatch ? parseInt(gidMatch[1], 10) : 0;

      allTags.push({
        id: numericId,
        src: edge.node.src,
        event: "onload",
        display_scope: edge.node.displayScope?.toLowerCase() || "all",
        cache: edge.node.cache,
        created_at: edge.node.createdAt,
        updated_at: edge.node.updatedAt,
      } as ScriptTag);
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    // Safety limit to prevent infinite loops
    if (allTags.length > 1000) {
      console.warn("ScriptTags pagination limit reached (1000)");
      break;
    }
  }

  return allTags;
}

/**
 * P2-2: Fetch all Web Pixels with pagination
 * Handles stores with more than 50 web pixels
 */
async function fetchAllWebPixels(admin: AdminApiContext): Promise<WebPixelInfo[]> {
  const allPixels: WebPixelInfo[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query GetWebPixels($cursor: String) {
        webPixels(first: 50, after: $cursor) {
          edges {
            node {
              id
              settings
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
      { variables: { cursor } }
    );

    const data = await response.json();
    const edges = data.data?.webPixels?.edges || [];
    const pageInfo: GraphQLPageInfo = data.data?.webPixels?.pageInfo || { hasNextPage: false, endCursor: null };

    for (const edge of edges as GraphQLEdge<WebPixelInfo>[]) {
      allPixels.push({
        id: edge.node.id,
        settings: edge.node.settings,
      });
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    // Safety limit
    if (allPixels.length > 200) {
      console.warn("WebPixels pagination limit reached (200)");
      break;
    }
  }

  return allPixels;
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

  // 1. Fetch ScriptTags using GraphQL API with pagination (P2-2)
  // Reference: https://shopify.dev/docs/api/admin-graphql/latest/queries/scriptTags
  try {
    result.scriptTags = await fetchAllScriptTags(admin);
    console.log(`Found ${result.scriptTags.length} script tags (with pagination)`);
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

  // 3. Fetch Web Pixels (App Pixels) using GraphQL with pagination (P2-2)
  try {
    result.webPixels = await fetchAllWebPixels(admin);
    console.log(`Found ${result.webPixels.length} web pixels (with pagination)`);
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
  const seenRiskKeys = new Set<string>(); // For deduplication

  // Helper to add risk with deduplication
  function addRisk(risk: RiskItem, dedupeKey?: string): void {
    const key = dedupeKey || `${risk.id}_${risk.platform || ""}`;
    if (!seenRiskKeys.has(key)) {
      seenRiskKeys.add(key);
      risks.push(risk);
    }
  }

  // Check for deprecated script tags
  // NOTE: Shopify's deprecation specifically targets order_status and thank_you pages
  // ScriptTags with display_scope="order_status" are high priority
  // Other display_scope values (online_store, all) are medium priority
  if (result.scriptTags.length > 0) {
    // Group by platform for cleaner risk reporting
    const platformScriptTags: Record<string, { orderStatus: ScriptTag[]; other: ScriptTag[] }> = {};
    
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
      
      if (!platformScriptTags[platform]) {
        platformScriptTags[platform] = { orderStatus: [], other: [] };
      }
      
      // Check display_scope - Shopify's deprecation focuses on order_status
      const displayScope = tag.display_scope || "all";
      if (displayScope === "order_status") {
        platformScriptTags[platform].orderStatus.push(tag);
      } else {
        platformScriptTags[platform].other.push(tag);
      }
    }
    
    // Create deduplicated risks per platform
    for (const [platform, tags] of Object.entries(platformScriptTags)) {
      // High priority: order_status scripts (directly affected by deprecation)
      if (tags.orderStatus.length > 0) {
        addRisk({
          id: "deprecated_script_tag_order_status",
          name: "订单状态页 ScriptTag（将被废弃）",
          description: `检测到 ${tags.orderStatus.length} 个用于订单状态页的 ScriptTag，这是 Shopify 废弃公告的主要目标`,
          severity: "high",
          points: 30,
          details: `平台: ${platform}, 脚本数量: ${tags.orderStatus.length}`,
          platform,
        }, `order_status_${platform}`);
      }
      
      // Medium priority: other scripts (general ScriptTag API deprecation)
      if (tags.other.length > 0) {
        addRisk({
          id: "deprecated_script_tag",
          name: "ScriptTag API（建议迁移）",
          description: `检测到 ${tags.other.length} 个 ScriptTag，建议迁移到 Web Pixel 以获得更好的兼容性`,
          severity: "medium",
          points: 15,
          details: `平台: ${platform}, 范围: ${tags.other.map(t => t.display_scope || "all").join(", ")}`,
          platform,
        }, `script_tag_${platform}`);
      }
    }
  }

  // Check if using old tracking methods without web pixels
  if (result.identifiedPlatforms.length > 0 && result.scriptTags.length > 0) {
    addRisk({
      id: "inline_tracking",
      name: "内联追踪代码",
      description: "检测到使用旧的追踪方式，建议迁移到 Shopify Web Pixel",
      severity: "medium",
      points: 20,
      details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
    }, "inline_tracking");
  }

  // Recommend server-side tracking
  if (result.identifiedPlatforms.length > 0) {
    addRisk({
      id: "no_server_side",
      name: "建议启用服务端追踪",
      description: "仅依赖客户端追踪可能导致 15-30% 的转化丢失",
      severity: "low",
      points: 10,
      details: "建议配置 Conversion API 以提高追踪准确性",
    }, "no_server_side");
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

// ==========================================
// P2-1: Manual Script Analysis
// ==========================================

/**
 * Analyze pasted script content (e.g., Additional Scripts from Shopify Admin)
 * 
 * This is used when the user manually pastes their Additional Scripts content
 * since we cannot read it via the Admin API.
 * 
 * @param content - The raw script content to analyze
 * @returns Analysis result with detected platforms, risks, and recommendations
 */
export interface ScriptAnalysisResult {
  identifiedPlatforms: string[];
  platformDetails: Array<{
    platform: string;
    type: string;
    confidence: "high" | "medium" | "low";
    matchedPattern: string;
  }>;
  risks: RiskItem[];
  riskScore: number;
  recommendations: string[];
}

export function analyzeScriptContent(content: string): ScriptAnalysisResult {
  const result: ScriptAnalysisResult = {
    identifiedPlatforms: [],
    platformDetails: [],
    risks: [],
    riskScore: 0,
    recommendations: [],
  };

  if (!content || content.trim().length === 0) {
    return result;
  }

  // Platform detection with detailed matching
  const platformMatches: Map<string, { type: string; pattern: string }[]> = new Map();

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        if (!platformMatches.has(platform)) {
          platformMatches.set(platform, []);
        }
        platformMatches.get(platform)!.push({
          type: getPatternType(platform, pattern),
          pattern: match[0],
        });
      }
    }
  }

  // Build platform details
  for (const [platform, matches] of platformMatches.entries()) {
    result.identifiedPlatforms.push(platform);
    
    for (const match of matches) {
      result.platformDetails.push({
        platform,
        type: match.type,
        confidence: matches.length > 1 ? "high" : "medium",
        matchedPattern: match.pattern.substring(0, 50) + (match.pattern.length > 50 ? "..." : ""),
      });
    }
  }

  // Detect specific ID patterns and add to platform details
  const ga4Match = content.match(/G-[A-Z0-9]{10,}/gi);
  if (ga4Match) {
    for (const id of ga4Match) {
      if (!result.platformDetails.some(d => d.matchedPattern.includes(id))) {
        result.platformDetails.push({
          platform: "google",
          type: "GA4 Measurement ID",
          confidence: "high",
          matchedPattern: id,
        });
      }
    }
  }

  const metaPixelMatch = content.match(/(?:pixel[_\-]?id|fbq\('init',)\s*['":]?\s*(\d{15,16})/gi);
  if (metaPixelMatch) {
    for (const match of metaPixelMatch) {
      const pixelId = match.match(/\d{15,16}/)?.[0];
      if (pixelId && !result.platformDetails.some(d => d.matchedPattern.includes(pixelId))) {
        result.platformDetails.push({
          platform: "meta",
          type: "Pixel ID",
          confidence: "high",
          matchedPattern: pixelId,
        });
      }
    }
  }

  // Assess risks for Additional Scripts
  if (result.identifiedPlatforms.length > 0) {
    result.risks.push({
      id: "additional_scripts_detected",
      name: "Additional Scripts 中检测到追踪代码",
      description: "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规",
      severity: "high" as RiskSeverity,
      points: 25,
      details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
    });

    // Add platform-specific risks
    if (result.identifiedPlatforms.includes("google") && content.includes("UA-")) {
      result.risks.push({
        id: "legacy_ua",
        name: "使用旧版 Universal Analytics",
        description: "Universal Analytics 已于 2023 年 7 月停止处理数据，请迁移到 GA4",
        severity: "high" as RiskSeverity,
        points: 30,
      });
    }

    if (content.includes("<script") && content.includes("</script>")) {
      result.risks.push({
        id: "inline_script_tags",
        name: "内联 Script 标签",
        description: "内联脚本可能影响页面加载性能，建议使用异步加载或 Web Pixel",
        severity: "medium" as RiskSeverity,
        points: 15,
      });
    }
  }

  // Calculate risk score
  result.riskScore = calculateRiskScore(result.risks);

  // Generate recommendations
  for (const platform of result.identifiedPlatforms) {
    switch (platform) {
      case "google":
        result.recommendations.push(
          "将 Google Analytics/Ads 追踪迁移到我们的 Web Pixel 扩展，支持 GA4 和 Google Ads 转化追踪"
        );
        break;
      case "meta":
        result.recommendations.push(
          "将 Meta Pixel 迁移到我们的 Web Pixel 扩展，并启用服务端 Conversions API (CAPI) 提高追踪准确性"
        );
        break;
      case "tiktok":
        result.recommendations.push(
          "将 TikTok Pixel 迁移到我们的 Web Pixel 扩展，并启用 Events API 进行服务端追踪"
        );
        break;
      case "bing":
        result.recommendations.push(
          "将 Microsoft UET 标签迁移到我们的 Web Pixel 扩展"
        );
        break;
      case "clarity":
        result.recommendations.push(
          "将 Microsoft Clarity 迁移到我们的 Web Pixel 扩展"
        );
        break;
      default:
        result.recommendations.push(
          `将 ${platform} 追踪代码迁移到 Web Pixel 以确保 Checkout Extensibility 兼容性`
        );
    }
  }

  if (result.identifiedPlatforms.length === 0 && content.length > 100) {
    result.recommendations.push(
      "未检测到已知追踪平台。如果您使用了自定义追踪代码，请确保它与 Checkout Extensibility 兼容。"
    );
  }

  return result;
}

/**
 * Get a human-readable type for a matched pattern
 */
function getPatternType(platform: string, pattern: RegExp): string {
  const patternStr = pattern.source;
  
  switch (platform) {
    case "google":
      if (patternStr.includes("gtag")) return "gtag() 函数调用";
      if (patternStr.includes("gtm")) return "Google Tag Manager";
      if (patternStr.includes("G-")) return "GA4 Measurement ID";
      if (patternStr.includes("AW-")) return "Google Ads Conversion ID";
      if (patternStr.includes("UA-")) return "Universal Analytics (已弃用)";
      return "Google 追踪代码";
    case "meta":
      if (patternStr.includes("fbq")) return "Meta Pixel 函数调用";
      if (patternStr.includes("facebook")) return "Facebook SDK";
      if (patternStr.includes("pixel")) return "Pixel ID";
      return "Meta 追踪代码";
    case "tiktok":
      if (patternStr.includes("ttq")) return "TikTok Pixel 函数调用";
      return "TikTok 追踪代码";
    case "bing":
      if (patternStr.includes("uet")) return "Microsoft UET 标签";
      return "Bing 追踪代码";
    case "clarity":
      return "Microsoft Clarity";
    default:
      return "追踪代码";
  }
}


