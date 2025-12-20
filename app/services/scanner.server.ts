import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import type { ScanResult, RiskItem, ScriptTag, CheckoutConfig, RiskSeverity } from "../types";
import { 
  getScriptTagDeprecationStatus, 
  getAdditionalScriptsDeprecationStatus,
  type ShopTier 
} from "../utils/deprecation-dates";

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
    
    /pixel[_\-]?id['":\s]+\d{15,16}/i,
  ],
  tiktok: [
    /ttq\s*\(/i,                    
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
  pinterest: [
    /pintrk/i,                      
    /pinimg\.com.*tag/i,            
  ],
  snapchat: [
    /snaptr/i,                      
    /sc-static\.net.*scevent/i,     
  ],
  twitter: [
    /twq\s*\(/i,                    
    /twitter.*pixel/i,              
    /static\.ads-twitter\.com/i,    
  ],
};

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

export type { ScanResult, RiskItem } from "../types";

interface ScanError {
  stage: string;
  message: string;
  timestamp: Date;
}

interface GraphQLEdge<T> {
  node: T;
  cursor: string;
}

interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

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

    if (allTags.length > 1000) {
      console.warn("ScriptTags pagination limit reached (1000)");
      break;
    }
  }

  return allTags;
}

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

    if (allPixels.length > 200) {
      console.warn("WebPixels pagination limit reached (200)");
      break;
    }
  }

  return allPixels;
}

export async function scanShopTracking(
  admin: AdminApiContext,
  shopId: string
): Promise<EnhancedScanResult> {
  const errors: ScanError[] = [];
  const result: EnhancedScanResult = {
    scriptTags: [],
    additionalScripts: null, 
    checkoutConfig: null,
    identifiedPlatforms: [],
    riskItems: [],
    riskScore: 0,
    webPixels: [],
    duplicatePixels: [],
    migrationActions: [],
  };

  console.log(`Starting enhanced scan for shop ${shopId}`);

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

  const allScriptContent = collectScriptContent(result);
  result.identifiedPlatforms = detectPlatforms(allScriptContent);
  console.log(`Identified platforms: ${result.identifiedPlatforms.join(", ") || "none"}`);

  result.duplicatePixels = detectDuplicatePixels(result);
  console.log(`Duplicate pixels found: ${result.duplicatePixels.length}`);

  result.riskItems = assessRisks(result);
  result.riskScore = calculateRiskScore(result.riskItems);
  console.log(`Risk assessment complete: score=${result.riskScore}, items=${result.riskItems.length}`);

  result.migrationActions = generateMigrationActions(result);
  console.log(`Generated ${result.migrationActions.length} migration actions`);

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

function detectDuplicatePixels(result: EnhancedScanResult): Array<{ platform: string; count: number; ids: string[] }> {
  const duplicates: Array<{ platform: string; count: number; ids: string[] }> = [];

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

  for (const pixel of result.webPixels) {
    if (pixel.settings) {
      try {
        const settings = typeof pixel.settings === "string" 
          ? JSON.parse(pixel.settings) 
          : pixel.settings;

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
        
      }
    }
  }

  for (const [platform, ids] of Object.entries(platformCounts)) {
    if (ids.length > 1) {
      duplicates.push({ platform, count: ids.length, ids });
    }
  }
  
  return duplicates;
}

function generateMigrationActions(result: EnhancedScanResult): MigrationAction[] {
  const actions: MigrationAction[] = [];
  
  // P0-1: Get dynamic deprecation status based on current date
  const scriptTagStatus = getScriptTagDeprecationStatus();
  const plusStatus = getAdditionalScriptsDeprecationStatus("plus");
  const nonPlusStatus = getAdditionalScriptsDeprecationStatus("non_plus");

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

    const isOrderStatusScript = tag.display_scope === "order_status";
    
    // P0-1: Dynamic deadline messaging based on current date
    let deadlineNote: string;
    let priority: "high" | "medium" | "low" = "high";
    
    if (scriptTagStatus.isExpired && isOrderStatusScript) {
      // ScriptTag already blocked
      deadlineNote = "⚠️ ScriptTag 在订单状态页的功能已被禁用，请立即迁移！";
      priority = "high";
    } else if (plusStatus.isExpired) {
      // Plus deadline passed
      deadlineNote = `Plus 商家: 已过期；非 Plus 商家: ${nonPlusStatus.isExpired ? "已过期" : `剩余 ${nonPlusStatus.daysRemaining} 天`}`;
      priority = "high";
    } else {
      // Both still in future
      deadlineNote = `Plus 商家: 剩余 ${plusStatus.daysRemaining} 天（2025-08-28）；非 Plus 商家: 剩余 ${nonPlusStatus.daysRemaining} 天（2026-08-26）`;
      priority = plusStatus.isWarning ? "high" : "medium";
    }
    
    actions.push({
      type: "delete_script_tag",
      priority,
      platform,
      title: `删除 ScriptTag: ${platform}`,
      description: `${deadlineNote}。请先配置 Web Pixel，然后删除此 ScriptTag。`,
      scriptTagId: tag.id,
      
      deadline: isOrderStatusScript ? "2026-08-26" : undefined,
    });
  }

  const configuredPlatforms = new Set<string>();
  for (const pixel of result.webPixels) {
    if (pixel.settings) {
      try {
        const settings = typeof pixel.settings === "string" 
          ? JSON.parse(pixel.settings) 
          : pixel.settings;

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

  for (const dup of result.duplicatePixels) {
    actions.push({
      type: "remove_duplicate",
      priority: "medium",
      platform: dup.platform,
      title: `清理重复的 ${dup.platform} 像素`,
      description: `检测到 ${dup.count} 个 ${dup.platform} 像素配置，可能导致重复追踪。建议只保留一个。`,
    });
  }

  // P1-2: Check if our App Pixel is configured (identified by ingestion_key or ingestion_secret)
  // Note: backend_url was removed from pixel settings - we now use a hardcoded production URL
  const hasAppPixelConfigured = result.webPixels.some(p => {
    if (!p.settings) return false;
    try {
      const settings = typeof p.settings === "string" ? JSON.parse(p.settings) : p.settings;
      // P1-2: Check for both new (ingestion_key) and legacy (ingestion_secret) field names
      const s = settings as Record<string, unknown>;
      return typeof s.ingestion_key === "string" || typeof s.ingestion_secret === "string";
    } catch {
      return false;
    }
  });
  
  if (!hasAppPixelConfigured && result.identifiedPlatforms.length > 0) {
    actions.push({
      type: "enable_capi",
      priority: "low",
      title: "启用服务端转化追踪 (CAPI)",
      description: "启用 Conversions API 可将追踪准确率提高 15-30%，不受广告拦截器影响。",
    });
  }

  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  
  return actions;
}

function collectScriptContent(result: EnhancedScanResult): string {
  let content = "";

  for (const tag of result.scriptTags) {
    content += ` ${tag.src || ""} ${tag.event || ""}`;
  }

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
  const seenRiskKeys = new Set<string>(); 

  function addRisk(risk: RiskItem, dedupeKey?: string): void {
    const key = dedupeKey || `${risk.id}_${risk.platform || ""}`;
    if (!seenRiskKeys.has(key)) {
      seenRiskKeys.add(key);
      risks.push(risk);
    }
  }

  if (result.scriptTags.length > 0) {
    
    const platformScriptTags: Record<string, { orderStatus: ScriptTag[]; other: ScriptTag[] }> = {};
    
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
      
      if (!platformScriptTags[platform]) {
        platformScriptTags[platform] = { orderStatus: [], other: [] };
      }

      const displayScope = tag.display_scope || "all";
      if (displayScope === "order_status") {
        platformScriptTags[platform].orderStatus.push(tag);
      } else {
        platformScriptTags[platform].other.push(tag);
      }
    }

    for (const [platform, tags] of Object.entries(platformScriptTags)) {
      
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

function calculateRiskScore(riskItems: RiskItem[]): number {
  if (riskItems.length === 0) {
    return 0;
  }

  const severityWeight: Record<RiskSeverity, number> = {
    high: 1.5,
    medium: 1.0,
    low: 0.5,
  };

  const weightedPoints = riskItems.reduce((sum, item) => {
    const weight = severityWeight[item.severity] || 1.0;
    return sum + item.points * weight;
  }, 0);

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

  if (result.identifiedPlatforms.length > 0) {
    result.risks.push({
      id: "additional_scripts_detected",
      name: "Additional Scripts 中检测到追踪代码",
      description: "建议迁移到 Web Pixel 以获得更好的兼容性和隐私合规",
      severity: "high" as RiskSeverity,
      points: 25,
      details: `检测到平台: ${result.identifiedPlatforms.join(", ")}`,
    });

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

  result.riskScore = calculateRiskScore(result.risks);

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

