

import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { analyzeScriptContent } from "./scanner/content-analysis";
import { PLATFORM_PATTERNS, PLATFORM_INFO, detectPlatforms } from "./scanner/patterns";
import type { AssetCategory, AssetSourceType, RiskLevel, SuggestedMigration } from "./audit-asset.server";
import crypto from "crypto";

export interface ManualPasteAnalysisResult {
  assets: Array<{
    category: AssetCategory;
    platform?: string;
    displayName: string;
    riskLevel: RiskLevel;
    suggestedMigration: SuggestedMigration;
    content: string;
    matchedPatterns: string[];
    confidence: "high" | "medium" | "low";
  }>;
  summary: {
    totalSnippets: number;
    identifiedCategories: Record<AssetCategory, number>;
    identifiedPlatforms: string[];
    overallRiskLevel: RiskLevel;
  };
}

/**
 * 分析手动粘贴的代码片段
 * 支持多段代码、容器片段识别
 */
export function analyzeManualPaste(
  content: string,
  shopId: string
): ManualPasteAnalysisResult {
  const assets: ManualPasteAnalysisResult["assets"] = [];
  const identifiedCategories: Record<AssetCategory, number> = {
    pixel: 0,
    affiliate: 0,
    survey: 0,
    support: 0,
    analytics: 0,
    other: 0,
  };
  const identifiedPlatforms = new Set<string>();

  // 分割代码片段（支持多种分隔符）
  const snippets = splitCodeSnippets(content);
  
  for (const snippet of snippets) {
    if (!snippet.trim()) continue;

    // 识别容器片段（如 GTM 容器、标签管理器等）
    const containerInfo = detectContainer(snippet);
    
    // 分析代码内容
    const analysis = analyzeScriptContent(snippet);
    
    // 智能分类
    const category = categorizeSnippet(snippet, analysis, containerInfo);
    identifiedCategories[category]++;
    
    // 收集识别的平台
    for (const platform of analysis.identifiedPlatforms) {
      identifiedPlatforms.add(platform);
    }
    
    // 确定平台（优先使用识别到的平台）
    const platform = analysis.identifiedPlatforms[0] || 
                     detectPlatformFromContent(snippet) ||
                     undefined;
    
    // 计算风险等级
    const riskLevel = calculateRiskLevel(category, platform, analysis, containerInfo);
    
    // 生成迁移建议
    const suggestedMigration = generateMigrationSuggestion(
      category,
      platform,
      analysis,
      containerInfo
    );
    
    // 确定置信度
    const confidence = determineConfidence(analysis, containerInfo, platform);
    
    assets.push({
      category,
      platform,
      displayName: generateDisplayName(category, platform, containerInfo),
      riskLevel,
      suggestedMigration,
      content: snippet.substring(0, 500), // 限制长度
      matchedPatterns: analysis.platformDetails.map(d => d.matchedPattern),
      confidence,
    });
  }

  // 计算总体风险等级
  const overallRiskLevel = calculateOverallRiskLevel(assets);

  return {
    assets,
    summary: {
      totalSnippets: snippets.length,
      identifiedCategories,
      identifiedPlatforms: Array.from(identifiedPlatforms),
      overallRiskLevel,
    },
  };
}

/**
 * 分割代码片段
 * 支持多种分隔符和格式
 */
function splitCodeSnippets(content: string): string[] {
  const snippets: string[] = [];
  
  // 先尝试按 script 标签分割
  const scriptMatches = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches && scriptMatches.length > 1) {
    return scriptMatches;
  }
  
  // 按多个换行符分割
  const lines = content.split(/\n{3,}/);
  if (lines.length > 1) {
    return lines.filter(line => line.trim().length > 10);
  }
  
  // 按注释分隔符分割（如：// === Snippet 1 ===）
  const commentSplit = content.split(/(?:^|\n)\s*\/\/\s*={3,}.*={3,}\s*(?:\n|$)/m);
  if (commentSplit.length > 1) {
    return commentSplit.filter(s => s.trim().length > 10);
  }
  
  // 如果没有明确的分隔符，返回整个内容
  return [content];
}

/**
 * 检测容器类型（GTM、标签管理器等）
 */
function detectContainer(content: string): {
  type: "gtm" | "tag_manager" | "data_layer" | "segment" | "tealium" | "adobe_launch" | "none";
  id?: string;
} {
  const lowerContent = content.toLowerCase();
  
  // Google Tag Manager
  if (lowerContent.includes("googletagmanager") || lowerContent.includes("gtm-")) {
    const gtmMatch = content.match(/GTM-[A-Z0-9]+/i);
    return {
      type: "gtm",
      id: gtmMatch?.[0],
    };
  }
  
  // Segment
  if (lowerContent.includes("segment.com") || 
      lowerContent.includes("analytics.js") && lowerContent.includes("segment") ||
      lowerContent.includes("cdn.segment.com")) {
    const segmentMatch = content.match(/writeKey['":\s]+['"]?([a-zA-Z0-9]+)['"]?/i);
    return {
      type: "segment",
      id: segmentMatch?.[1],
    };
  }
  
  // Tealium
  if (lowerContent.includes("tealium") || 
      lowerContent.includes("tiqcdn.com") ||
      lowerContent.includes("utag.js")) {
    const tealiumMatch = content.match(/utag\.(?:load|view|link)\(['"]?([^'"]+)['"]?/i);
    return {
      type: "tealium",
      id: tealiumMatch?.[1],
    };
  }
  
  // Adobe Launch (formerly DTM)
  if (lowerContent.includes("adobe launch") || 
      lowerContent.includes("assets.adobedtm.com") ||
      lowerContent.includes("launch") && lowerContent.includes("adobe")) {
    return {
      type: "adobe_launch",
    };
  }
  
  // 通用标签管理器
  if (lowerContent.includes("tag manager") || 
      lowerContent.includes("dataLayer") ||
      lowerContent.includes("data-layer")) {
    return {
      type: "tag_manager",
    };
  }
  
  // Data Layer
  if (lowerContent.includes("datalayer") || lowerContent.includes("dataLayer")) {
    return {
      type: "data_layer",
    };
  }
  
  return { type: "none" };
}

/**
 * 智能分类代码片段
 */
function categorizeSnippet(
  content: string,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): AssetCategory {
  const lowerContent = content.toLowerCase();
  
  // 像素追踪
  const pixelKeywords = ["pixel", "tracking", "analytics", "gtag", "fbq", "ttq"];
  const hasPixelKeywords = pixelKeywords.some(keyword => lowerContent.includes(keyword));
  if (hasPixelKeywords || analysis.identifiedPlatforms.length > 0) {
    // 检查是否是广告像素
    const adPlatforms = ["google_ads", "meta", "tiktok", "pinterest", "snapchat"];
    if (analysis.identifiedPlatforms.some(p => adPlatforms.includes(p))) {
      return "pixel";
    }
    // 检查是否是分析工具
    const analyticsPlatforms = ["google", "clarity", "hotjar", "lucky_orange"];
    if (analysis.identifiedPlatforms.some(p => analyticsPlatforms.includes(p))) {
      return "analytics";
    }
    // 默认归类为像素
    return "pixel";
  }
  
  // 联盟/分佣
  const affiliateKeywords = ["affiliate", "referral", "commission", "partner", "refersion", "tapfiliate"];
  if (affiliateKeywords.some(keyword => lowerContent.includes(keyword))) {
    return "affiliate";
  }
  
  // 问卷/调查
  const surveyKeywords = ["survey", "poll", "feedback", "questionnaire", "fairing", "zigpoll"];
  if (surveyKeywords.some(keyword => lowerContent.includes(keyword))) {
    return "survey";
  }
  
  // 客服/支持
  const supportKeywords = ["support", "chat", "helpdesk", "customer service", "zendesk", "intercom"];
  if (supportKeywords.some(keyword => lowerContent.includes(keyword))) {
    return "support";
  }
  
  // GTM 容器通常包含多种类型
  if (containerInfo.type === "gtm" || containerInfo.type === "tag_manager") {
    return "pixel"; // 默认归类为像素，但会在迁移建议中说明
  }
  
  return "other";
}

/**
 * 从内容中检测平台（增强版）
 * 支持更多平台和更精确的匹配
 */
function detectPlatformFromContent(content: string): string | undefined {
  const lowerContent = content.toLowerCase();
  
  // 检测 GA4 Measurement ID (更精确的匹配)
  const ga4Match = content.match(/G-[A-Z0-9]{10,}/i);
  if (ga4Match) return "google";
  
  // 检测 Universal Analytics (已弃用，但需要识别)
  const uaMatch = content.match(/UA-\d+-\d+/i);
  if (uaMatch) return "google";
  
  // 检测 Google Ads Conversion ID
  const googleAdsMatch = content.match(/AW-\d{9,}/i);
  if (googleAdsMatch) return "google_ads";
  
  // 检测 Meta Pixel ID (多种格式)
  const metaPatterns = [
    /fbq\s*\(['"]init['"]\s*,\s*['"]?(\d{15,16})['"]?/i,
    /pixel[_-]?id['":\s]+['"]?(\d{15,16})['"]?/i,
    /facebook[_-]?pixel[_-]?id['":\s]+['"]?(\d{15,16})['"]?/i,
    /connect\.facebook\.net\/.*\/fbevents\.js[^'"]*id=(\d{15,16})/i,
  ];
  for (const pattern of metaPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "meta";
  }
  
  // 检测 TikTok Pixel (多种格式)
  const tiktokPatterns = [
    /ttq\s*\.\s*load\s*\(['"]?([A-Z0-9]+)['"]?/i,
    /tiktok[_-]?pixel[_-]?id['":\s]+['"]?([A-Z0-9]+)['"]?/i,
    /analytics\.tiktok\.com\/i18n\/pixel\/events[^'"]*id=([A-Z0-9]+)/i,
  ];
  for (const pattern of tiktokPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "tiktok";
  }
  
  // 检测 Pinterest Tag (多种格式)
  const pinterestPatterns = [
    /pintrk\s*\(['"]load['"]\s*,\s*['"]?([A-Z0-9]+)['"]?/i,
    /pinterest[_-]?tag[_-]?id['":\s]+['"]?([A-Z0-9]+)['"]?/i,
    /pinimg\.com\/.*\/tag[^'"]*id=([A-Z0-9]+)/i,
  ];
  for (const pattern of pinterestPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "pinterest";
  }
  
  // 检测 Snapchat Pixel
  const snapPatterns = [
    /snaptr\s*\(['"]init['"]\s*,\s*['"]?([A-Z0-9-]+)['"]?/i,
    /snapchat[_-]?pixel[_-]?id['":\s]+['"]?([A-Z0-9-]+)['"]?/i,
    /sc-static\.net\/.*\/scevent[^'"]*id=([A-Z0-9-]+)/i,
  ];
  for (const pattern of snapPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "snapchat";
  }
  
  // 检测 Microsoft Advertising (Bing UET)
  if (lowerContent.includes("uetq") || lowerContent.includes("bat.bing.com")) {
    return "bing";
  }
  
  // 检测 Microsoft Clarity
  if (lowerContent.includes("clarity") || lowerContent.includes("clarity.ms")) {
    return "clarity";
  }
  
  // 检测 Twitter/X Pixel
  if (lowerContent.includes("twq") || (lowerContent.includes("twitter") && lowerContent.includes("pixel"))) {
    return "twitter";
  }
  
  // 检测 LinkedIn Insight Tag
  if (lowerContent.includes("linkedin") && (lowerContent.includes("insight") || lowerContent.includes("_linkedin_partnerid"))) {
    return "linkedin";
  }
  
  // 检测 Reddit Pixel
  if (lowerContent.includes("rdt") || (lowerContent.includes("reddit") && lowerContent.includes("pixel"))) {
    return "reddit";
  }
  
  // 检测 Criteo
  if (lowerContent.includes("criteo") || lowerContent.includes("criteo.net")) {
    return "criteo";
  }
  
  return undefined;
}

/**
 * 计算风险等级（增强版）
 * 考虑更多因素：平台重要性、分析结果、容器类型等
 */
function calculateRiskLevel(
  category: AssetCategory,
  platform: string | undefined,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): RiskLevel {
  let riskScore = analysis.riskScore || 0;
  
  // 高风险场景
  // 1. 关键广告平台像素
  if (category === "pixel" && platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(platform)) {
      riskScore += 30; // 关键平台加权
    }
  }
  
  // 2. 检测到 PII 访问或 window/document 使用
  const hasHighRiskPatterns = analysis.risks.some(
    r => r.id === "pii_access" || r.id === "window_document_access"
  );
  if (hasHighRiskPatterns) {
    riskScore += 25;
  }
  
  // 3. GTM 容器通常包含多种追踪，风险较高
  if (containerInfo.type === "gtm") {
    riskScore += 15;
  }
  
  // 4. 阻塞加载的代码
  const hasBlockingLoad = analysis.risks.some(r => r.id === "blocking_load");
  if (hasBlockingLoad) {
    riskScore += 20;
  }
  
  // 5. 订单状态页脚本（Shopify 废弃的主要目标）
  if (category === "pixel" && platform) {
    // 如果是在订单状态页使用的像素，风险更高
    riskScore += 10;
  }
  
  // 中风险场景
  // 1. 一般像素追踪
  if (category === "pixel" && !platform) {
    riskScore += 15;
  }
  
  // 2. 联盟追踪
  if (category === "affiliate") {
    riskScore += 20;
  }
  
  // 3. 问卷工具（可能影响用户体验）
  if (category === "survey") {
    riskScore += 10;
  }
  
  // 低风险场景
  // 1. 分析工具（通常不影响转化）
  if (category === "analytics") {
    riskScore -= 10;
  }
  
  // 2. 客服支持（影响较小）
  if (category === "support") {
    riskScore -= 5;
  }
  
  // 根据最终风险评分确定等级
  if (riskScore >= 70) {
    return "high";
  } else if (riskScore >= 40) {
    return "medium";
  } else {
    return "low";
  }
}

/**
 * 生成迁移建议
 */
function generateMigrationSuggestion(
  category: AssetCategory,
  platform: string | undefined,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): SuggestedMigration {
  // 基于类别
  switch (category) {
    case "pixel":
      return "web_pixel";
    case "survey":
    case "support":
      return "ui_extension";
    case "affiliate":
      return "server_side";
    case "analytics":
      return "none"; // 分析工具通常不需要迁移到像素
    default:
      return "web_pixel";
  }
}

/**
 * 确定置信度
 */
function determineConfidence(
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>,
  platform: string | undefined
): "high" | "medium" | "low" {
  // 高置信度：明确识别到平台，且匹配度高
  if (platform && analysis.identifiedPlatforms.includes(platform)) {
    const platformDetail = analysis.platformDetails.find(d => d.platform === platform);
    if (platformDetail && platformDetail.confidence === "high") {
      return "high";
    }
  }
  
  // 中置信度：识别到平台但匹配度中等
  if (platform || analysis.identifiedPlatforms.length > 0) {
    return "medium";
  }
  
  // 低置信度：未识别到明确平台
  return "low";
}

/**
 * 生成显示名称
 */
function generateDisplayName(
  category: AssetCategory,
  platform: string | undefined,
  containerInfo: ReturnType<typeof detectContainer>
): string {
  // 容器类型优先显示
  if (containerInfo.type === "gtm" && containerInfo.id) {
    return `Google Tag Manager (${containerInfo.id})`;
  }
  if (containerInfo.type === "segment" && containerInfo.id) {
    return `Segment (${containerInfo.id})`;
  }
  if (containerInfo.type === "tealium" && containerInfo.id) {
    return `Tealium (${containerInfo.id})`;
  }
  if (containerInfo.type === "adobe_launch") {
    return "Adobe Launch";
  }
  if (containerInfo.type === "tag_manager") {
    return "标签管理器";
  }
  
  if (platform) {
    const platformInfo = PLATFORM_INFO[platform];
    if (platformInfo) {
      return platformInfo.name;
    }
    return platform.charAt(0).toUpperCase() + platform.slice(1);
  }
  
  const categoryNames: Record<AssetCategory, string> = {
    pixel: "追踪像素",
    affiliate: "联盟追踪",
    survey: "售后问卷",
    support: "客服支持",
    analytics: "分析工具",
    other: "其他脚本",
  };
  
  return categoryNames[category] || "未知资产";
}

/**
 * 计算总体风险等级
 */
function calculateOverallRiskLevel(
  assets: ManualPasteAnalysisResult["assets"]
): RiskLevel {
  if (assets.length === 0) return "low";
  
  const riskCounts = {
    high: assets.filter(a => a.riskLevel === "high").length,
    medium: assets.filter(a => a.riskLevel === "medium").length,
    low: assets.filter(a => a.riskLevel === "low").length,
  };
  
  if (riskCounts.high > 0) {
    return "high";
  }
  
  if (riskCounts.medium > assets.length / 2) {
    return "medium";
  }
  
  return "low";
}

/**
 * 增强的风险评分算法
 * 基于平台、依赖、使用频率、迁移难度等因素
 */
export function calculateEnhancedRiskScore(
  category: AssetCategory,
  platform: string | undefined,
  riskLevel: RiskLevel,
  usageFrequency?: "high" | "medium" | "low",
  hasDependencies?: boolean,
  migrationDifficulty?: "easy" | "medium" | "hard",
  confidence?: "high" | "medium" | "low"
): number {
  let score = 0;
  
  // 基础风险等级分数
  const baseScores: Record<RiskLevel, number> = {
    high: 70,
    medium: 40,
    low: 20,
  };
  score = baseScores[riskLevel] || 40;
  
  // 类别加权
  const categoryWeights: Record<AssetCategory, number> = {
    pixel: 1.2,
    affiliate: 1.1,
    survey: 0.9,
    support: 0.8,
    analytics: 0.7,
    other: 1.0,
  };
  score *= categoryWeights[category] || 1.0;
  
  // 平台重要性加权
  if (platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(platform)) {
      score *= 1.15;
    }
    // 广告平台加权更高
    const adPlatforms = ["google_ads", "meta", "tiktok", "pinterest", "snapchat"];
    if (adPlatforms.includes(platform)) {
      score *= 1.1;
    }
  }
  
  // 使用频率加权
  if (usageFrequency) {
    const frequencyWeights = {
      high: 1.2,
      medium: 1.0,
      low: 0.8,
    };
    score *= frequencyWeights[usageFrequency];
  }
  
  // 依赖关系加权
  if (hasDependencies) {
    score *= 1.1;
  }
  
  // 迁移难度加权（难度越高，风险越高）
  if (migrationDifficulty) {
    const difficultyWeights = {
      easy: 0.9,
      medium: 1.0,
      hard: 1.2,
    };
    score *= difficultyWeights[migrationDifficulty];
  }
  
  // 置信度加权（置信度越低，风险越高，因为不确定性增加）
  if (confidence) {
    const confidenceWeights = {
      high: 1.0,
      medium: 1.05,
      low: 1.15,
    };
    score *= confidenceWeights[confidence];
  }
  
  return Math.min(100, Math.round(score));
}

/**
 * 自动分析依赖关系
 * 基于脚本内容、平台和业务逻辑推断依赖关系
 */
export function analyzeDependenciesFromContent(
  assets: ManualPasteAnalysisResult["assets"],
  allAssets: Array<{ id: string; category: AssetCategory; platform?: string }>
): Map<string, string[]> {
  const dependencyMap = new Map<string, string[]>();
  
  for (const asset of assets) {
    const dependencies: string[] = [];
    
    // 基于类别的依赖推断
    switch (asset.category) {
      case "affiliate":
        // 联盟追踪通常依赖像素追踪
        const pixelAssets = allAssets.filter(
          (a) => a.category === "pixel" && 
                 (asset.platform ? a.platform === asset.platform : true)
        );
        if (pixelAssets.length > 0) {
          dependencies.push(pixelAssets[0].id);
        }
        break;
        
      case "survey":
        // 问卷可能依赖订单追踪功能
        const orderTracking = allAssets.find(
          (a) => a.category === "support" || a.category === "pixel"
        );
        if (orderTracking) {
          dependencies.push(orderTracking.id);
        }
        break;
        
      case "analytics":
        // 分析工具可能依赖像素追踪
        const analyticsPixels = allAssets.filter(
          (a) => a.category === "pixel"
        );
        if (analyticsPixels.length > 0) {
          dependencies.push(analyticsPixels[0].id);
        }
        break;
    }
    
    // 相同平台的依赖关系
    if (asset.platform) {
      const samePlatformAssets = allAssets.filter(
        (a) => a.platform === asset.platform && 
               a.category === "pixel" &&
               a.id !== asset.platform
      );
      // 如果当前资产不是像素，可能依赖相同平台的像素
      if (asset.category !== "pixel" && samePlatformAssets.length > 0) {
        dependencies.push(samePlatformAssets[0].id);
      }
    }
    
    if (dependencies.length > 0) {
      dependencyMap.set(asset.platform || asset.category, dependencies);
    }
  }
  
  return dependencyMap;
}

/**
 * 生成内容指纹用于去重
 * 基于内容的关键特征生成唯一标识
 */
function generateContentFingerprint(
  content: string,
  category: AssetCategory,
  platform?: string
): string {
  // 提取关键特征
  const normalizedContent = content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/['"]/g, "")
    .trim();
  
  // 提取 ID 和关键标识符
  const ids: string[] = [];
  
  // GA4 Measurement ID
  const ga4Match = normalizedContent.match(/g-[a-z0-9]{10,}/i);
  if (ga4Match) ids.push(ga4Match[0]);
  
  // Meta Pixel ID
  const metaMatch = normalizedContent.match(/\d{15,16}/);
  if (metaMatch) ids.push(`meta-${metaMatch[0]}`);
  
  // TikTok Pixel
  const tiktokMatch = normalizedContent.match(/ttq[^)]*['"]?([a-z0-9]+)['"]?/i);
  if (tiktokMatch && tiktokMatch[1]) ids.push(`tiktok-${tiktokMatch[1]}`);
  
  // Pinterest Tag
  const pinterestMatch = normalizedContent.match(/pintrk[^)]*['"]?([a-z0-9]+)['"]?/i);
  if (pinterestMatch && pinterestMatch[1]) ids.push(`pinterest-${pinterestMatch[1]}`);
  
  // 生成指纹
  const fingerprintContent = JSON.stringify({
    category,
    platform: platform || "",
    ids: ids.sort(),
    // 使用内容的前 200 个字符作为特征
    contentHash: crypto.createHash("sha256").update(normalizedContent.substring(0, 200)).digest("hex").slice(0, 16),
  });
  
  return crypto.createHash("sha256").update(fingerprintContent).digest("hex").slice(0, 32);
}

/**
 * 批量处理手动粘贴的资产（增强版，支持去重）
 */
export async function processManualPasteAssets(
  shopId: string,
  content: string,
  scanReportId?: string
): Promise<{ created: number; updated: number; failed: number; duplicates: number }> {
  try {
    const analysis = analyzeManualPaste(content, shopId);
    
    // 获取现有资产用于去重检查
    const { getAuditAssets } = await import("./audit-asset.server");
    const existingAssets = await getAuditAssets(shopId);
    const existingFingerprints = new Set(
      existingAssets
        .filter(a => a.fingerprint)
        .map(a => a.fingerprint!)
    );
    
    let duplicates = 0;
    const assets = analysis.assets
      .map(asset => {
        const fingerprint = generateContentFingerprint(
          asset.content,
          asset.category,
          asset.platform
        );
        
        // 检查是否重复
        if (existingFingerprints.has(fingerprint)) {
          duplicates++;
          return null;
        }
        
        existingFingerprints.add(fingerprint);
        
        // 计算增强的风险评分
        const enhancedRiskScore = calculateEnhancedRiskScore(
          asset.category,
          asset.platform,
          asset.riskLevel,
          undefined, // usageFrequency
          false, // hasDependencies
          asset.confidence === "low" ? "hard" : asset.confidence === "medium" ? "medium" : "easy", // migrationDifficulty
          asset.confidence
        );
        
        return {
          sourceType: "manual_paste" as AssetSourceType,
          category: asset.category,
          platform: asset.platform,
          displayName: asset.displayName,
          fingerprint,
          riskLevel: asset.riskLevel,
          suggestedMigration: asset.suggestedMigration,
          details: {
            content: asset.content,
            matchedPatterns: asset.matchedPatterns,
            confidence: asset.confidence,
            enhancedRiskScore,
            analyzedAt: new Date().toISOString(),
          },
          scanReportId,
        };
      })
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
    
    const { batchCreateAuditAssets } = await import("./audit-asset.server");
    const result = await batchCreateAuditAssets(shopId, assets, scanReportId);
    
    return {
      ...result,
      duplicates,
    };
  } catch (error) {
    logger.error("Failed to process manual paste assets", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { created: 0, updated: 0, failed: 1, duplicates: 0 };
  }
}

