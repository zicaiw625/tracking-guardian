import { logger } from "../utils/logger.server";
import { analyzeScriptContent } from "./scanner/content-analysis";
import { PLATFORM_INFO } from "./scanner/patterns";
import { detectRisksInContent } from "./scanner/risk-detector.server";
import { getAuditAssets, batchCreateAuditAssets } from "./audit-asset.server";
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
    detectedRisks?: {
      piiAccess: boolean;
      windowDocumentAccess: boolean;
      blockingLoad: boolean;
      duplicateTriggers: boolean;
      riskScore: number;
    };
  }>;
  summary: {
    totalSnippets: number;
    identifiedCategories: Record<AssetCategory, number>;
    identifiedPlatforms: string[];
    overallRiskLevel: RiskLevel;
  };
}

export function analyzeManualPaste(
  content: string,
  _shopId: string
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
  const snippets = splitCodeSnippets(content);
  for (const snippet of snippets) {
    if (!snippet.trim()) continue;
    const containerInfo = detectContainer(snippet);
    const analysis = analyzeScriptContent(snippet);
    const category = categorizeSnippet(snippet, analysis, containerInfo);
    identifiedCategories[category]++;
    for (const platform of analysis.identifiedPlatforms) {
      identifiedPlatforms.add(platform);
    }
    const platform = analysis.identifiedPlatforms[0] ||
                     detectPlatformFromContent(snippet) ||
                     undefined;
    const riskDetection = detectRisksInContent(snippet);
    const baseRiskLevel = calculateRiskLevel(category, platform, analysis, containerInfo);
    const riskLevel = riskDetection.detectedIssues.piiAccess ||
                       riskDetection.detectedIssues.windowDocumentAccess ||
                       riskDetection.detectedIssues.blockingLoad
      ? (baseRiskLevel === "low" ? "medium" : baseRiskLevel === "medium" ? "high" : "high")
      : baseRiskLevel;
    const suggestedMigration = generateMigrationSuggestion(
      category,
      platform,
      analysis,
      containerInfo,
      riskDetection
    );
    const confidence = determineConfidence(analysis, containerInfo, platform);
    assets.push({
      category,
      platform,
      displayName: generateDisplayName(category, platform, containerInfo),
      riskLevel,
      suggestedMigration,
      content: snippet.substring(0, 500),
      matchedPatterns: analysis.platformDetails.map(d => d.matchedPattern),
      confidence,
      detectedRisks: {
        piiAccess: riskDetection.detectedIssues.piiAccess,
        windowDocumentAccess: riskDetection.detectedIssues.windowDocumentAccess,
        blockingLoad: riskDetection.detectedIssues.blockingLoad,
        duplicateTriggers: riskDetection.detectedIssues.duplicateTriggers,
        riskScore: riskDetection.riskScore,
      },
    });
  }
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

function splitCodeSnippets(content: string): string[] {
  const snippets: string[] = [];
  const scriptMatches = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches && scriptMatches.length > 1) {
    return scriptMatches;
  }
  const functionBlockPattern = /(?:gtag|fbq|ttq|pintrk|snaptr|dataLayer\.push)\s*\([^)]*\)(?:\s*,\s*\([^)]*\))*/gi;
  const functionBlocks = content.match(functionBlockPattern);
  if (functionBlocks && functionBlocks.length > 1) {

    const hasClearSeparators = content.match(/\n\s*\n|\/\/\s*[^\n]+\n/);
    if (hasClearSeparators) {
      return functionBlocks.filter(block => block.trim().length > 10);
    }
  }
  const lines = content.split(/\n{2,}/);
  if (lines.length > 1) {
    return lines.filter(line => line.trim().length > 10);
  }
  const commentSplit = content.split(/(?:^|\n)\s*(?:\/\/|\/\*)\s*={3,}.*={3,}\s*(?:\*\/)?\s*(?:\n|$)/m);
  if (commentSplit.length > 1) {
    return commentSplit.filter(s => s.trim().length > 10);
  }
  const platformMarkers = [
    /(?:<!--\s*)?(?:Google|GA4|Meta|Facebook|TikTok|Pinterest|Snapchat)/gi,
    /(?:<!--\s*)?(?:开始|结束).*追踪/gi,
  ];
  let hasMultiplePlatforms = false;
  for (const marker of platformMarkers) {
    const matches = content.match(marker);
    if (matches && matches.length > 1) {
      hasMultiplePlatforms = true;
      break;
    }
  }
  if (hasMultiplePlatforms) {

    const platformSplit = content.split(/(?:<!--\s*)?(?:Google|GA4|Meta|Facebook|TikTok|Pinterest|Snapchat|开始|结束)/gi);
    if (platformSplit.length > 1) {
      return platformSplit.filter(s => s.trim().length > 10);
    }
  }
  if (content.length > 500) {

    const logicalBlocks = content.split(/(?:\n\s*)(?=(?:var|let|const|function|window\.|document\.))/);
    if (logicalBlocks.length > 1) {
      return logicalBlocks.filter(block => block.trim().length > 20);
    }
  }
  return [content];
}
function detectContainer(content: string): {
  type: "gtm" | "tag_manager" | "data_layer" | "segment" | "tealium" | "adobe_launch" | "none";
  id?: string;
} {
  const lowerContent = content.toLowerCase();
  if (lowerContent.includes("googletagmanager") || lowerContent.includes("gtm-")) {
    const gtmMatch = content.match(/GTM-[A-Z0-9]+/i);
    return {
      type: "gtm",
      id: gtmMatch?.[0],
    };
  }
  if (lowerContent.includes("segment.com") ||
      lowerContent.includes("analytics.js") && lowerContent.includes("segment") ||
      lowerContent.includes("cdn.segment.com")) {
    const segmentMatch = content.match(/writeKey['":\s]+['"]?([a-zA-Z0-9]+)['"]?/i);
    return {
      type: "segment",
      id: segmentMatch?.[1],
    };
  }
  if (lowerContent.includes("tealium") ||
      lowerContent.includes("tiqcdn.com") ||
      lowerContent.includes("utag.js")) {
    const tealiumMatch = content.match(/utag\.(?:load|view|link)\(['"]?([^'"]+)['"]?/i);
    return {
      type: "tealium",
      id: tealiumMatch?.[1],
    };
  }

  if (lowerContent.includes("adobe launch") ||
      lowerContent.includes("assets.adobedtm.com") ||
      lowerContent.includes("launch") && lowerContent.includes("adobe")) {
    return {
      type: "adobe_launch",
    };
  }

  if (lowerContent.includes("tag manager") ||
      lowerContent.includes("dataLayer") ||
      lowerContent.includes("data-layer")) {
    return {
      type: "tag_manager",
    };
  }

  if (lowerContent.includes("datalayer") || lowerContent.includes("dataLayer")) {
    return {
      type: "data_layer",
    };
  }

  return { type: "none" };
}
function categorizeSnippet(
  content: string,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): AssetCategory {
  const lowerContent = content.toLowerCase();

  const pixelKeywords = ["pixel", "tracking", "analytics", "gtag", "fbq", "ttq"];
  const hasPixelKeywords = pixelKeywords.some(keyword => lowerContent.includes(keyword));
  if (hasPixelKeywords || analysis.identifiedPlatforms.length > 0) {
    const adPlatforms = ["google_ads", "meta", "tiktok", "pinterest", "snapchat"];
    if (analysis.identifiedPlatforms.some(p => adPlatforms.includes(p))) {
      return "pixel";
    }
    const analyticsPlatforms = ["google", "clarity", "hotjar", "lucky_orange"];
    if (analysis.identifiedPlatforms.some(p => analyticsPlatforms.includes(p))) {
      return "analytics";
    }
    return "pixel";
  }

  const affiliateKeywords = [
    "affiliate", "referral", "commission", "partner",
    "refersion", "tapfiliate", "referralcandy", "impact.com",
    "partnerstack", "firstpromoter", "rewardful", "post Affiliate Pro",
    "affiliatewp", "affiliatly", "everflow", "cake", "hasoffers",
    "affiliate_id", "referral_code", "affiliate_code", "partner_id",
    "utm_source.*affiliate", "ref=", "referrer=", "aff=",
    "联盟", "分佣", "推荐", "返利"
  ];
  const affiliatePatterns = [
    /affiliate[_-]?(?:id|code|key|token)/i,
    /referral[_-]?(?:id|code|key|token)/i,
    /partner[_-]?(?:id|code|key|token)/i,
    /commission[_-]?(?:rate|amount|id)/i,
    /utm_source.*=.*affiliate/i,
    /ref[=:]\s*['"]?[a-zA-Z0-9]+['"]?/i,
    /referrer[=:]\s*['"]?[a-zA-Z0-9]+['"]?/i,
  ];

  const hasAffiliateKeyword = affiliateKeywords.some(keyword => lowerContent.includes(keyword));
  const hasAffiliatePattern = affiliatePatterns.some(pattern => pattern.test(content));

  if (hasAffiliateKeyword || hasAffiliatePattern) {
    const knownAffiliatePlatforms = [
      "refersion", "tapfiliate", "referralcandy", "impact",
      "partnerstack", "firstpromoter", "rewardful", "affiliatewp"
    ];
    const isKnownPlatform = knownAffiliatePlatforms.some(platform =>
      lowerContent.includes(platform)
    );
    if (isKnownPlatform || hasAffiliatePattern) {
      return "affiliate";
    }
  }

  const surveyKeywords = ["survey", "poll", "feedback", "questionnaire", "fairing", "zigpoll"];
  if (surveyKeywords.some(keyword => lowerContent.includes(keyword))) {
    return "survey";
  }

  const supportKeywords = ["support", "chat", "helpdesk", "customer service", "zendesk", "intercom"];
  if (supportKeywords.some(keyword => lowerContent.includes(keyword))) {
    return "support";
  }

  if (containerInfo.type === "gtm" || containerInfo.type === "tag_manager") {
    return "pixel";
  }

  return "other";
}
function detectPlatformFromContent(content: string): string | undefined {
  const lowerContent = content.toLowerCase();

  const ga4Match = content.match(/G-[A-Z0-9]{10,}/i);
  if (ga4Match) return "google";

  const uaMatch = content.match(/UA-\d+-\d+/i);
  if (uaMatch) return "google";

  const googleAdsMatch = content.match(/AW-\d{9,}/i);
  if (googleAdsMatch) return "google_ads";

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
  const tiktokPatterns = [
    /ttq\s*\.\s*load\s*\(['"]?([A-Z0-9]+)['"]?/i,
    /tiktok[_-]?pixel[_-]?id['":\s]+['"]?([A-Z0-9]+)['"]?/i,
    /analytics\.tiktok\.com\/i18n\/pixel\/events[^'"]*id=([A-Z0-9]+)/i,
  ];
  for (const pattern of tiktokPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "tiktok";
  }
  const pinterestPatterns = [
    /pintrk\s*\(['"]load['"]\s*,\s*['"]?([A-Z0-9]+)['"]?/i,
    /pinterest[_-]?tag[_-]?id['":\s]+['"]?([A-Z0-9]+)['"]?/i,
    /pinimg\.com\/.*\/tag[^'"]*id=([A-Z0-9]+)/i,
  ];
  for (const pattern of pinterestPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "pinterest";
  }
  const snapPatterns = [
    /snaptr\s*\(['"]init['"]\s*,\s*['"]?([A-Z0-9-]+)['"]?/i,
    /snapchat[_-]?pixel[_-]?id['":\s]+['"]?([A-Z0-9-]+)['"]?/i,
    /sc-static\.net\/.*\/scevent[^'"]*id=([A-Z0-9-]+)/i,
  ];
  for (const pattern of snapPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) return "snapchat";
  }
  if (lowerContent.includes("uetq") || lowerContent.includes("bat.bing.com")) {
    return "bing";
  }
  if (lowerContent.includes("clarity") || lowerContent.includes("clarity.ms")) {
    return "clarity";
  }
  if (lowerContent.includes("twq") || (lowerContent.includes("twitter") && lowerContent.includes("pixel"))) {
    return "twitter";
  }
  if (lowerContent.includes("linkedin") && (lowerContent.includes("insight") || lowerContent.includes("_linkedin_partnerid"))) {
    return "linkedin";
  }
  if (lowerContent.includes("rdt") || (lowerContent.includes("reddit") && lowerContent.includes("pixel"))) {
    return "reddit";
  }
  if (lowerContent.includes("criteo") || lowerContent.includes("criteo.net")) {
    return "criteo";
  }
  if (lowerContent.includes("linkedin") && (lowerContent.includes("insight") || lowerContent.includes("_linkedin_partnerid"))) {
    const linkedinMatch = content.match(/_linkedin_partnerid\s*=\s*['"]?(\d+)['"]?/i);
    if (linkedinMatch) return "linkedin";
  }
  if (lowerContent.includes("gemini") || lowerContent.includes("yahoo") && lowerContent.includes("advertising")) {
    return "yahoo";
  }
  if (lowerContent.includes("amazon") && (lowerContent.includes("dsp") || lowerContent.includes("advertising"))) {
    return "amazon_ads";
  }
  if (lowerContent.includes("thetradedesk") || lowerContent.includes("ttd") || lowerContent.includes("adsrvr.org")) {
    return "tradedesk";
  }
  if (lowerContent.includes("criteo") && (lowerContent.includes("retargeting") || lowerContent.includes("dynamic"))) {
    return "criteo";
  }
  if (lowerContent.includes("adroll") || lowerContent.includes("adroll.com")) {
    return "adroll";
  }
  if (lowerContent.includes("klaviyo") || lowerContent.includes("_learnq") || lowerContent.includes("klaviyo.com")) {
    return "klaviyo";
  }
  if (lowerContent.includes("segment") || lowerContent.includes("cdn.segment.com") || lowerContent.includes("analytics.js") && lowerContent.includes("segment")) {
    return "segment";
  }
  if (lowerContent.includes("mixpanel") || lowerContent.includes("mixpanel.com")) {
    return "mixpanel";
  }
  if (lowerContent.includes("amplitude") || lowerContent.includes("amplitude.com")) {
    return "amplitude";
  }
  return undefined;
}
function calculateRiskLevel(
  category: AssetCategory,
  platform: string | undefined,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>
): RiskLevel {
  let riskScore = analysis.riskScore || 0;
  if (category === "pixel" && platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(platform)) {
      riskScore += 30;
    }
  }
  const hasHighRiskPatterns = analysis.risks.some(
    r => r.id === "pii_access" || r.id === "window_document_access"
  );
  if (hasHighRiskPatterns) {
    riskScore += 25;
  }
  if (containerInfo.type === "gtm") {
    riskScore += 15;
  }
  const hasBlockingLoad = analysis.risks.some(r => r.id === "blocking_load");
  if (hasBlockingLoad) {
    riskScore += 20;
  }
  if (category === "pixel" && platform) {
    riskScore += 10;
  }
  if (category === "pixel" && !platform) {
    riskScore += 15;
  }
  if (category === "affiliate") {
    riskScore += 20;
  }
  if (category === "survey") {
    riskScore += 10;
  }
  if (category === "analytics") {
    riskScore -= 10;
  }
  if (category === "support") {
    riskScore -= 5;
  }
  if (riskScore >= 70) {
    return "high";
  } else if (riskScore >= 40) {
    return "medium";
  } else {
    return "low";
  }
}
function generateMigrationSuggestion(
  category: AssetCategory,
  platform: string | undefined,
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>,
  riskDetection?: ReturnType<typeof detectRisksInContent>
): SuggestedMigration {
  if (riskDetection) {
    if (riskDetection.detectedIssues.piiAccess) {
      return "server_side";
    }
    if (riskDetection.detectedIssues.windowDocumentAccess && category === "pixel") {
      return "ui_extension";
    }
  }
  switch (category) {
    case "pixel":
      return "web_pixel";
    case "survey":
    case "support":
      return "ui_extension";
    case "affiliate":
      return "server_side";
    case "analytics":
      return "none";
    default:
      return "web_pixel";
  }
}
function determineConfidence(
  analysis: ReturnType<typeof analyzeScriptContent>,
  containerInfo: ReturnType<typeof detectContainer>,
  platform: string | undefined
): "high" | "medium" | "low" {
  if (platform && analysis.identifiedPlatforms.includes(platform)) {
    const platformDetail = analysis.platformDetails.find(d => d.platform === platform);
    if (platformDetail && platformDetail.confidence === "high") {
      return "high";
    }
  }
  if (platform || analysis.identifiedPlatforms.length > 0) {
    return "medium";
  }
  return "low";
}
function generateDisplayName(
  category: AssetCategory,
  platform: string | undefined,
  containerInfo: ReturnType<typeof detectContainer>
): string {
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
  const baseScores: Record<RiskLevel, number> = {
    high: 70,
    medium: 40,
    low: 20,
  };
  score = baseScores[riskLevel] || 40;
  const categoryWeights: Record<AssetCategory, number> = {
    pixel: 1.2,
    affiliate: 1.1,
    survey: 0.9,
    support: 0.8,
    analytics: 0.7,
    other: 1.0,
  };
  score *= categoryWeights[category] || 1.0;
  if (platform) {
    const criticalPlatforms = ["google", "meta", "tiktok"];
    if (criticalPlatforms.includes(platform)) {
      score *= 1.15;
    }
    const adPlatforms = ["google_ads", "meta", "tiktok", "pinterest", "snapchat"];
    if (adPlatforms.includes(platform)) {
      score *= 1.1;
    }
  }
  if (usageFrequency) {
    const frequencyWeights = {
      high: 1.2,
      medium: 1.0,
      low: 0.8,
    };
    score *= frequencyWeights[usageFrequency];
  }
  if (hasDependencies) {
    score *= 1.1;
  }
  if (migrationDifficulty) {
    const difficultyWeights = {
      easy: 0.9,
      medium: 1.0,
      hard: 1.2,
    };
    score *= difficultyWeights[migrationDifficulty];
  }
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
export function analyzeDependenciesFromContent(
  assets: ManualPasteAnalysisResult["assets"],
  allAssets: Array<{ id: string; category: AssetCategory; platform?: string }>
): Map<string, string[]> {
  const dependencyMap = new Map<string, string[]>();
  for (const asset of assets) {
    const dependencies: string[] = [];
    switch (asset.category) {
      case "affiliate": {
        const pixelAssets = allAssets.filter(
          (a) => a.category === "pixel" &&
                 (asset.platform ? a.platform === asset.platform : true)
        );
        if (pixelAssets.length > 0) {
          dependencies.push(pixelAssets[0].id);
        }
        break;
      }
      case "survey": {
        const orderTracking = allAssets.find(
          (a) => a.category === "support" || a.category === "pixel"
        );
        if (orderTracking) {
          dependencies.push(orderTracking.id);
        }
        break;
      }
      case "analytics": {
        const analyticsPixels = allAssets.filter(
          (a) => a.category === "pixel"
        );
        if (analyticsPixels.length > 0) {
          dependencies.push(analyticsPixels[0].id);
        }
        break;
      }
    }
    if (asset.platform) {
      const samePlatformAssets = allAssets.filter(
        (a) => a.platform === asset.platform &&
               a.category === "pixel" &&
               a.id !== asset.platform
      );
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
function generateContentFingerprint(
  content: string,
  category: AssetCategory,
  platform?: string
): string {
  const normalizedContent = content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/['"]/g, "")
    .trim();
  const ids: string[] = [];
  const ga4Match = normalizedContent.match(/g-[a-z0-9]{10,}/i);
  if (ga4Match) ids.push(ga4Match[0]);
  const metaMatch = normalizedContent.match(/\d{15,16}/);
  if (metaMatch) ids.push(`meta-${metaMatch[0]}`);
  const tiktokMatch = normalizedContent.match(/ttq[^)]*['"]?([a-z0-9]+)['"]?/i);
  if (tiktokMatch && tiktokMatch[1]) ids.push(`tiktok-${tiktokMatch[1]}`);
  const pinterestMatch = normalizedContent.match(/pintrk[^)]*['"]?([a-z0-9]+)['"]?/i);
  if (pinterestMatch && pinterestMatch[1]) ids.push(`pinterest-${pinterestMatch[1]}`);
  const fingerprintContent = JSON.stringify({
    category,
    platform: platform || "",
    ids: ids.sort(),
    contentHash: crypto.createHash("sha256").update(normalizedContent.substring(0, 200)).digest("hex").slice(0, 16),
  });
  return crypto.createHash("sha256").update(fingerprintContent).digest("hex").slice(0, 32);
}
export async function processManualPasteAssets(
  shopId: string,
  content: string,
  scanReportId?: string
): Promise<{ created: number; updated: number; failed: number; duplicates: number }> {
  try {
    const analysis = analyzeManualPaste(content, shopId);
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
        if (existingFingerprints.has(fingerprint)) {
          duplicates++;
          return null;
        }
        existingFingerprints.add(fingerprint);
        const enhancedRiskScore = calculateEnhancedRiskScore(
          asset.category,
          asset.platform,
          asset.riskLevel,
          undefined,
          false,
          asset.confidence === "low" ? "hard" : asset.confidence === "medium" ? "medium" : "easy",
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
            detectedRisks: asset.detectedRisks ? {
              piiAccess: asset.detectedRisks.piiAccess,
              windowDocumentAccess: asset.detectedRisks.windowDocumentAccess,
              blockingLoad: asset.detectedRisks.blockingLoad,
              duplicateTriggers: asset.detectedRisks.duplicateTriggers,
              riskScore: asset.detectedRisks.riskScore,
            } : undefined,
          },
          scanReportId,
        };
      })
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
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
