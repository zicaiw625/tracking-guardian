

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createAuditAsset,
  getAuditAssets,
  getAuditAssetSummary,
  updateMigrationStatus,
  deleteAuditAsset,
  type AssetSourceType,
  type AssetCategory,
  type RiskLevel,
  type SuggestedMigration,
  type MigrationStatus,
} from "../services/audit-asset.server";
import { analyzeScriptContent } from "../services/scanner/content-analysis";
import { logger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category") as AssetCategory | null;
  const riskLevel = url.searchParams.get("riskLevel") as RiskLevel | null;
  const migrationStatus = url.searchParams.get("migrationStatus") as MigrationStatus | null;
  const includeSummary = url.searchParams.get("summary") === "true";

  try {
    const assets = await getAuditAssets(shop.id, {
      category: category || undefined,
      riskLevel: riskLevel || undefined,
      migrationStatus: migrationStatus || undefined,
    });

    if (includeSummary) {
      const summary = await getAuditAssetSummary(shop.id);
      return json({ assets, summary });
    }

    return json({ assets });
  } catch (error) {
    logger.error("Failed to fetch audit assets", { error });
    return json({ error: "Failed to fetch audit assets" }, { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const method = request.method.toUpperCase();

  if (method === "DELETE") {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("id");

    if (!assetId) {
      return json({ error: "Missing asset ID" }, { status: 400 });
    }

    const success = await deleteAuditAsset(assetId);
    return json({ success });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  try {
    switch (actionType) {
      case "create_from_paste": {

        const scriptContent = formData.get("scriptContent") as string;

        if (!scriptContent) {
          return json({ error: "Missing script content" }, { status: 400 });
        }

        const MAX_SCRIPT_LENGTH = 1024 * 1024;
        if (scriptContent.length > MAX_SCRIPT_LENGTH) {
          return json({
            error: `Script content too large. Maximum size is ${MAX_SCRIPT_LENGTH / 1024}KB`
          }, { status: 400 });
        }

        const analysisResult = analyzeScriptContent(scriptContent);

        const createdAssets = [];
        for (const platform of analysisResult.identifiedPlatforms) {
          const asset = await createAuditAsset(shop.id, {
            sourceType: "manual_paste",
            category: "pixel",
            platform,
            displayName: `手动粘贴: ${platform}`,
            riskLevel: "high",
            suggestedMigration: "web_pixel",
            details: {
              source: "manual_paste",
              analysisRiskScore: analysisResult.riskScore,
              detectedPatterns: analysisResult.platformDetails
                .filter(d => d.type === platform)
                .map(d => d.matchedPattern),
            },
          });
          if (asset) createdAssets.push(asset);
        }

        if (analysisResult.identifiedPlatforms.length === 0 && analysisResult.riskScore > 0) {
          const asset = await createAuditAsset(shop.id, {
            sourceType: "manual_paste",
            category: "other",
            displayName: "未识别的脚本",
            riskLevel: analysisResult.riskScore > 60 ? "high" : "medium",
            suggestedMigration: "none",
            details: {
              source: "manual_paste",
              analysisRiskScore: analysisResult.riskScore,
              risks: analysisResult.risks,
            },
          });
          if (asset) createdAssets.push(asset);
        }

        return json({
          success: true,
          analysisResult: {
            riskScore: analysisResult.riskScore,
            platforms: analysisResult.identifiedPlatforms,
            risks: analysisResult.risks.length,
          },
          createdAssets: createdAssets.length,
          assets: createdAssets,
        });
      }

      case "confirm_merchant": {

        const platform = formData.get("platform") as string;
        const category = formData.get("category") as AssetCategory || "pixel";
        const displayName = formData.get("displayName") as string;

        const asset = await createAuditAsset(shop.id, {
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

        return json({
          success: !!asset,
          asset,
        });
      }

      case "update_status": {

        const assetId = formData.get("assetId") as string;
        const status = formData.get("status") as MigrationStatus;

        if (!assetId || !status) {
          return json({ error: "Missing assetId or status" }, { status: 400 });
        }

        const success = await updateMigrationStatus(assetId, status);
        return json({ success });
      }

      default:
        return json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    logger.error("AuditAsset action error", { actionType, error });
    return json({ error: "Operation failed" }, { status: 500 });
  }
};

