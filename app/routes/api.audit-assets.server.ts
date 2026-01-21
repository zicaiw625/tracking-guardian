import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  createAuditAsset,
  getAuditAssets,
  getAuditAssetSummary,
  updateMigrationStatus,
  deleteAuditAsset,
  getAuditAssetWithRawSnippet,
  type AssetCategory,
  type MigrationStatus,
} from "../services/audit-asset.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { logger } from "../utils/logger.server";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";
import { getShopIdByDomain } from "../services/db/shop-repository.server";
import { AppError, ErrorCode, Errors } from "../utils/errors/app-error";
import { successResponse } from "../utils/errors/result-response";

const MAX_SCRIPT_LENGTH = 1024 * 1024;

async function getShopIdFromSession(request: Request): Promise<string> {
  const { session } = await authenticate.admin(request);
  const shopId = await getShopIdByDomain(session.shop);
  if (!shopId) {
    throw Errors.shopNotFound(session.shop);
  }
  return shopId;
}

const MAX_PLATFORM_NAME_LENGTH = 50;
const MAX_ITEM_NAME_LENGTH = 255;
const MAX_ITEM_TYPE_LENGTH = 50;
const MAX_PLATFORMS_COUNT = 100;
const MAX_ITEMS_COUNT = 100;

function validateScriptContent(scriptContent: unknown): { valid: boolean; error?: AppError } {
  if (!scriptContent || typeof scriptContent !== "string") {
    return { valid: false, error: Errors.missingField("scriptContent") };
  }
  if (scriptContent.length === 0) {
    return { valid: false, error: new AppError(ErrorCode.VALIDATION_ERROR, "Script content cannot be empty", false, { field: "scriptContent" }) };
  }
  if (scriptContent.length > MAX_SCRIPT_LENGTH) {
    return { valid: false, error: Errors.payloadTooLarge(scriptContent.length, MAX_SCRIPT_LENGTH) };
  }
  if (scriptContent.trim().length === 0) {
    return { valid: false, error: new AppError(ErrorCode.VALIDATION_ERROR, "Script content cannot be only whitespace", false, { field: "scriptContent" }) };
  }
  const suspiciousPatterns = [
    /<script[^>]*>.*eval\s*\(/i,
    /<script[^>]*>.*Function\s*\(/i,
    /javascript:\s*eval/i,
    /onerror\s*=/i,
    /onload\s*=/i,
  ];
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(scriptContent)) {
      return { valid: false, error: new AppError(ErrorCode.VALIDATION_ERROR, "Script content contains potentially unsafe patterns", false, { field: "scriptContent" }) };
    }
  }
  return { valid: true };
}

function validatePlatformName(platform: string): boolean {
  return typeof platform === "string" &&
    platform.length > 0 &&
    platform.length <= MAX_PLATFORM_NAME_LENGTH &&
    /^[a-zA-Z0-9_-]+$/.test(platform);
}

function validateItem(item: unknown): item is { name: string; type: string } {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  if (!("name" in item) || !("type" in item)) {
    return false;
  }
  const name = item.name;
  const type = item.type;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_ITEM_NAME_LENGTH) {
    return false;
  }
  if (typeof type !== "string" || type.length === 0 || type.length > MAX_ITEM_TYPE_LENGTH) {
    return false;
  }
  return true;
}

async function handleCreateFromPaste(
  shopId: string,
  scriptContent: string
): Promise<Response> {
  const validation = validateScriptContent(scriptContent);
  if (!validation.valid && validation.error) {
    throw validation.error;
  }
  const analysisResult = analyzeScriptContent(scriptContent);
  const createdAssets = [];
  try {
    for (const platform of analysisResult.identifiedPlatforms) {
      const asset = await createAuditAsset(shopId, {
        sourceType: "manual_paste",
        category: "pixel",
        platform,
        displayName: `手动粘贴: ${platform}`,
        riskLevel: "high",
        suggestedMigration: "web_pixel",
        details: {
          content: scriptContent,
          source: "manual_paste",
          analysisRiskScore: analysisResult.riskScore,
          detectedPatterns: analysisResult.platformDetails
            .filter((d: { platform: string }) => d.platform === platform)
            .map((d: { matchedPattern: string }) => d.matchedPattern),
        },
      });
      if (asset) createdAssets.push(asset);
    }
    if (analysisResult.identifiedPlatforms.length === 0 && analysisResult.riskScore > 0) {
      const asset = await createAuditAsset(shopId, {
        sourceType: "manual_paste",
        category: "other",
        displayName: "未识别的脚本",
        riskLevel: analysisResult.riskScore > 60 ? "high" : "medium",
        suggestedMigration: "none",
        details: {
          content: scriptContent,
          source: "manual_paste",
          analysisRiskScore: analysisResult.riskScore,
          risks: analysisResult.risks,
        },
      });
      if (asset) createdAssets.push(asset);
    }
  } catch (error) {
    logger.error("Failed to create audit assets from paste", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, "Failed to create audit assets", { shopId });
  }
  return successResponse({
    analysisResult: {
      riskScore: analysisResult.riskScore,
      platforms: analysisResult.identifiedPlatforms,
      risks: analysisResult.risks.length,
    },
    createdAssets: createdAssets.length,
    assets: createdAssets,
  });
}

async function handleConfirmMerchant(
  shopId: string,
  platform: string | null,
  category: AssetCategory,
  displayName: string | null
): Promise<Response> {
  const asset = await createAuditAsset(shopId, {
    sourceType: "merchant_confirmed",
    category,
    platform: platform || undefined,
    displayName: displayName || `商家确认: ${platform || category}`,
    riskLevel: "high",
    suggestedMigration: category === "pixel" ? "web_pixel" : "ui_extension",
    details: {
      source: "merchant_confirmed",
      confirmedAt: new Date().toISOString(),
    },
  });
  return successResponse({
    asset,
  });
}

function validateAssetId(assetId: unknown): AppError | null {
  if (typeof assetId !== "string" || assetId.trim().length === 0) {
    return Errors.missingField("assetId");
  }
  if (assetId.length > 255) {
    return Errors.invalidFormat("assetId", "string with max length 255");
  }
  return null;
}

async function handleUpdateStatus(
  shopId: string,
  assetId: string,
  status: MigrationStatus
): Promise<Response> {
  const assetIdError = validateAssetId(assetId);
  if (assetIdError) {
    throw assetIdError;
  }
  if (!status) {
    throw Errors.missingField("status");
  }
  const success = await updateMigrationStatus(shopId, assetId, status);
  return successResponse({ success });
}

async function handleCreateFromList(
  shopId: string,
  platforms: string[],
  items: Array<{ name: string; type: string }>
): Promise<Response> {
  const createdAssets = [];
  try {
    for (const platform of platforms) {
      if (typeof platform !== "string") continue;
      const asset = await createAuditAsset(shopId, {
        sourceType: "merchant_confirmed",
        category: "pixel",
        platform,
        displayName: `升级向导清单: ${platform}`,
        riskLevel: "high",
        suggestedMigration: "web_pixel",
        details: {
          source: "upgrade_guide_list",
          importedAt: new Date().toISOString(),
        },
      });
      if (asset) createdAssets.push(asset);
    }
    for (const item of items) {
      if (!item || typeof item.name !== "string" || typeof item.type !== "string") continue;
      const category = (item.type === "pixel" ? "pixel" :
                      item.type === "survey" ? "survey" :
                      item.type === "support" ? "support" :
                      item.type === "affiliate" ? "affiliate" : "other") as AssetCategory;
      const asset = await createAuditAsset(shopId, {
        sourceType: "merchant_confirmed",
        category,
        displayName: `升级向导清单: ${item.name}`,
        riskLevel: category === "pixel" ? "high" : "medium",
        suggestedMigration: category === "pixel" ? "web_pixel" :
                           category === "survey" || category === "support" ? "ui_extension" :
                           category === "affiliate" ? "server_side" : "none",
        details: {
          source: "upgrade_guide_list",
          itemName: item.name,
          itemType: item.type,
          importedAt: new Date().toISOString(),
        },
      });
      if (asset) createdAssets.push(asset);
    }
  } catch (error) {
    logger.error("Failed to create audit assets from list", {
      shopId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, "Failed to create audit assets", { shopId });
  }
  return successResponse({
    created: createdAssets.length,
    assets: createdAssets,
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const shopId = await getShopIdFromSession(request);
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");
    if (assetId) {
      const result = await getAuditAssetWithRawSnippet(assetId, shopId);
      if (!result) {
        throw AppError.notFound("Asset", assetId);
      }
      return successResponse({ asset: result.asset, rawSnippet: result.rawSnippet });
    }
    const category = url.searchParams.get("category") as AssetCategory | null;
    const migrationStatus = url.searchParams.get("migrationStatus") as MigrationStatus | null;
    const includeSummary = url.searchParams.get("summary") === "true";
    const assets = await getAuditAssets(shopId, {
      category: category || undefined,
      migrationStatus: migrationStatus || undefined,
    });
    if (includeSummary) {
      const summary = await getAuditAssetSummary(shopId);
      return successResponse({ assets, summary });
    }
    return successResponse({ assets });
  } catch (error) {
    logger.error("Failed to fetch audit assets", { error });
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, "Failed to fetch audit assets");
  }
};

interface RequestData {
  actionType: string;
  jsonBody: Record<string, unknown> | null;
  formData: FormData | null;
}

async function parseRequestData(request: Request): Promise<RequestData> {
  const contentType = request.headers.get("Content-Type") || "";
  let actionType: string | null = null;
  let jsonBody: Record<string, unknown> | null = null;
  let formData: FormData | null = null;

  if (contentType.includes("application/json")) {
    try {
      jsonBody = await readJsonWithSizeLimit(request);
      const a = jsonBody?.action;
      const b = jsonBody?._action;
      actionType = typeof a === "string" ? a : typeof b === "string" ? b : null;
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      throw new AppError(ErrorCode.VALIDATION_ERROR, "Failed to parse request body", false);
    }
  } else {
    formData = await request.formData();
    const actionValue = formData.get("_action") || formData.get("action");
    actionType = typeof actionValue === "string" ? actionValue : null;
  }

  if (!actionType) {
    throw Errors.missingField("action");
  }

  return { actionType, jsonBody, formData };
}

function createValueExtractors(jsonBody: Record<string, unknown> | null, formData: FormData | null) {
  return {
    getStringValue(key: string): string {
      const jsonVal = jsonBody?.[key];
      const formVal = formData?.get(key);
      const value = jsonVal ?? formVal;
      return typeof value === "string" ? value : "";
    },
    getNullableStringValue(key: string): string | null {
      const jsonVal = jsonBody?.[key];
      const formVal = formData?.get(key);
      const value = jsonVal ?? formVal;
      if (value === null || value === undefined) return null;
      return typeof value === "string" ? value : null;
    },
    getCategoryValue(key: string): AssetCategory {
      const jsonVal = jsonBody?.[key];
      const formVal = formData?.get(key);
      const value = jsonVal ?? formVal ?? "pixel";
      return isAssetCategory(value) ? value : "pixel";
    },
    getMigrationStatusValue(key: string): MigrationStatus | null {
      const jsonVal = jsonBody?.[key];
      const formVal = formData?.get(key);
      const value = jsonVal ?? formVal;
      if (!value || typeof value !== "string") return null;
      return isMigrationStatus(value) ? value : null;
    },
  };
}

function isAssetCategory(value: unknown): value is AssetCategory {
  return typeof value === "string" &&
    (value === "pixel" || value === "survey" || value === "support" || value === "affiliate" || value === "other");
}

function isMigrationStatus(value: unknown): value is MigrationStatus {
  return typeof value === "string" &&
    (value === "pending" || value === "in_progress" || value === "completed" || value === "skipped");
}

function parseCreateFromListData(jsonBody: Record<string, unknown> | null): { platforms: string[]; items: Array<{ name: string; type: string }> } {
  const platformsJson = jsonBody?.platforms;
  const platforms: string[] = Array.isArray(platformsJson)
    ? platformsJson.filter((p): p is string => validatePlatformName(p))
    : [];
  const itemsJson = jsonBody?.items;
  const items: Array<{ name: string; type: string }> = Array.isArray(itemsJson)
    ? itemsJson.filter(validateItem)
    : [];
  if (platforms.length > MAX_PLATFORMS_COUNT) {
    throw Errors.payloadTooLarge(platforms.length, MAX_PLATFORMS_COUNT);
  }
  if (items.length > MAX_ITEMS_COUNT) {
    throw Errors.payloadTooLarge(items.length, MAX_ITEMS_COUNT);
  }
  return { platforms, items };
}

async function handleDeleteAction(shopId: string, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("id");
  const assetIdError = validateAssetId(assetId);
  if (assetIdError) {
    throw assetIdError;
  }
  const success = await deleteAuditAsset(shopId, assetId!);
  return successResponse({ success });
}

async function handleActionByType(
  shopId: string,
  actionType: string,
  jsonBody: Record<string, unknown> | null,
  formData: FormData | null
): Promise<Response> {
  const extractors = createValueExtractors(jsonBody, formData);

  switch (actionType) {
    case "create_from_paste": {
      const scriptContent = extractors.getStringValue("scriptContent");
      return handleCreateFromPaste(shopId, scriptContent);
    }
    case "confirm_merchant": {
      const platform = extractors.getNullableStringValue("platform");
      const category = extractors.getCategoryValue("category");
      const displayName = extractors.getNullableStringValue("displayName");
      return handleConfirmMerchant(shopId, platform, category, displayName);
    }
    case "update_status": {
      const assetId = extractors.getStringValue("assetId");
      const status = extractors.getMigrationStatusValue("status");
      if (!status) {
        throw Errors.missingField("status");
      }
      return handleUpdateStatus(shopId, assetId, status);
    }
    case "create_from_list": {
      const { platforms, items } = parseCreateFromListData(jsonBody);
      return handleCreateFromList(shopId, platforms, items);
    }
    default:
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown action: ${actionType}`, false, { actionType });
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const shopId = await getShopIdFromSession(request);
    const method = request.method.toUpperCase();
    if (method === "DELETE") {
      return handleDeleteAction(shopId, request);
    }
    const { actionType, jsonBody, formData } = await parseRequestData(request);
    return handleActionByType(shopId, actionType, jsonBody, formData);
  } catch (error) {
    logger.error("AuditAsset action error", { error });
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, "Operation failed");
  }
};
