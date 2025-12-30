

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
  type: "gtm" | "tag_manager" | "data_layer" | "none";
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
 * 从内容中检测平台
 */
function detectPlatformFromContent(content: string): string | undefined {
  // 检测 GA4 Measurement ID
  const ga4Match = content.match(/G-[A-Z0-9]{10,}/i);
  if (ga4Match) return "google";
  
  // 检测 Meta Pixel ID
  const metaMatch = content.match(/(?:fbq\s*\(['"]init['"]\s*,\s*['"]?|pixel[_-]?id['":\s]+)(\d{15,16})/i);
  if (metaMatch) return "meta";
  
  // 检测 TikTok Pixel
  const tiktokMatch = content.match(/ttq\s*\.\s*load\s*\(['"]?([A-Z0-9]+)['"]?/i);
  if (tiktokMatch) return "tiktok";
  
  // 检测 Pinterest Tag
  const pinterestMatch = content.match(/pintrk\s*\(['"]load['"]\s*,\s*['"]?([A-Z0-9]+)['"]?/i);
  if (pinterestMatch) return "pinterest";
  
  // 检测 Snapchat Pixel
  const snapMatch = content.match(/snaptr\s*\(['"]init['"]\s*,\s*['"]?([A-Z0-9-]+)['"]?/i);
  if (snapMatch) return "snapchat";
  
  return undefined;
}

/**
 * 计算风险等级
 */
function calculateRiskLevel(
  category: AssetCategory,
  platform: string | undefined,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): RiskLevel {
  // 高风险场景
  if (category === "pixel" && platform && 
      ["google", "meta", "tiktok"].includes(platform)) {
    return "high";
  }
  
  if (analysis.riskScore >= 70) {
    return "high";
  }
  
  // 中风险场景
  if (category === "pixel" || category === "affiliate") {
    return "medium";
  }
  
  if (analysis.riskScore >= 40) {
    return "medium";
  }
  
  // 低风险场景
  if (category === "analytics" || category === "support") {
    return "low";
  }
  
  return "medium";
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
  if (containerInfo.type === "gtm" && containerInfo.id) {
    return `Google Tag Manager (${containerInfo.id})`;
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
 * 基于平台、依赖、使用频率等因素
 */
export function calculateEnhancedRiskScore(
  category: AssetCategory,
  platform: string | undefined,
  riskLevel: RiskLevel,
  usageFrequency?: "high" | "medium" | "low",
  hasDependencies?: boolean
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
  
  return Math.min(100, Math.round(score));
}

/**
 * 批量处理手动粘贴的资产
 */
export async function processManualPasteAssets(
  shopId: string,
  content: string,
  scanReportId?: string
): Promise<{ created: number; updated: number; failed: number }> {
  try {
    const analysis = analyzeManualPaste(content, shopId);
    
    const assets = analysis.assets.map(asset => ({
      sourceType: "manual_paste" as AssetSourceType,
      category: asset.category,
      platform: asset.platform,
      displayName: asset.displayName,
      riskLevel: asset.riskLevel,
      suggestedMigration: asset.suggestedMigration,
      details: {
        content: asset.content,
        matchedPatterns: asset.matchedPatterns,
        confidence: asset.confidence,
        analyzedAt: new Date().toISOString(),
      },
      scanReportId,
    }));
    
    const { batchCreateAuditAssets } = await import("./audit-asset.server");
    return await batchCreateAuditAssets(shopId, assets, scanReportId);
  } catch (error) {
    logger.error("Failed to process manual paste assets", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { created: 0, updated: 0, failed: 1 };
  }
}

