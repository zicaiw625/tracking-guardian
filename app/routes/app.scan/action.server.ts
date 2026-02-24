import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import { i18nServer } from "../../i18n.server";
import prisma from "../../db.server";
import { scanShopTracking, type ScriptAnalysisResult } from "../../services/scanner.server";
import { createAuditAsset, batchCreateAuditAssets, type AuditAssetInput } from "../../services/audit-asset.server";
import { generateMigrationChecklist } from "../../services/migration-checklist.server";
import { SAVE_ANALYSIS_LIMITS, PLATFORM_NAME_REGEX } from "../../utils/scan-constants";
import { z } from "zod";
import { checkSensitiveInfoInData } from "../../utils/scan-validation";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../../utils/security";
import { sanitizeFilename } from "../../utils/responses";
import { logger } from "../../utils/logger.server";
import type { RiskItem } from "../../types";

const AnalysisDataSchema = z.object({
    identifiedPlatforms: z.array(z.string().min(SAVE_ANALYSIS_LIMITS.MIN_PLATFORM_NAME_LENGTH).max(SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_NAME_LENGTH).regex(PLATFORM_NAME_REGEX))
        .max(SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS),
    platformDetails: z.array(z.object({
        platform: z.string(),
        type: z.string(),
        confidence: z.enum(["high", "medium", "low"]),
        matchedPattern: z.string()
    })).max(SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS),
    risks: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        severity: z.enum(["high", "medium", "low"])
    })).max(SAVE_ANALYSIS_LIMITS.MAX_RISKS),
    recommendations: z.array(z.string().min(1).max(SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATION_LENGTH))
        .max(SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS),
    riskScore: z.number().int().min(SAVE_ANALYSIS_LIMITS.MIN_RISK_SCORE).max(SAVE_ANALYSIS_LIMITS.MAX_RISK_SCORE)
});

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const t = await i18nServer.getFixedT(request);
    const formData = await request.formData();
    const actionType = formData.get("_action");
    if (actionType === "save_analysis") {
        try {
            const analysisDataStr = formData.get("analysisData") as string;
            if (!analysisDataStr) {
                return json({ error: t("scan.action.missingData") }, { status: 400 });
            }
            if (analysisDataStr.length > SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE) {
                logger.warn("Analysis data too large", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    maxSize: SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE
                });
                return json({
                    error: t("scan.action.dataTooLarge", { maxSizeKB: SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE / 1024 })
                }, { status: 400 });
            }
            let parsedData: unknown;
            try {
                parsedData = JSON.parse(analysisDataStr);
            } catch (parseError) {
                logger.warn("Failed to parse analysis data JSON", {
                    shopId: shop.id,
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                    actionType: "save_analysis"
                });
                return json({ error: t("scan.action.invalidJSON") }, { status: 400 });
            }

            const validationResult = AnalysisDataSchema.safeParse(parsedData);
            if (!validationResult.success) {
                const errorMessage = validationResult.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", ");
                logger.warn("Analysis data validation failed", {
                    shopId: shop.id,
                    error: errorMessage,
                    actionType: "save_analysis"
                });
                return json({ error: t("scan.action.invalidDataFormat", { error: errorMessage }) }, { status: 400 });
            }

            const data = validationResult.data;
            if (checkSensitiveInfoInData(parsedData)) {
                logger.warn("Analysis data contains potential sensitive information", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    actionType: "save_analysis"
                });
                return json({
                    error: t("scan.action.sensitiveInfoDetected")
                }, { status: 400 });
            }

            const platformDetailsRaw = data.platformDetails;
            const sanitizedPlatformDetails = Array.isArray(platformDetailsRaw)
                ? platformDetailsRaw
                    .filter((detail): detail is {
                        platform: string;
                        type: string;
                        confidence: "high" | "medium" | "low";
                        matchedPattern: string;
                    } => {
                        if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
                            return false;
                        }
                        return (
                            typeof detail.platform === "string" &&
                            typeof detail.type === "string" &&
                            typeof detail.matchedPattern === "string" &&
                            (detail.confidence === "high" || detail.confidence === "medium" || detail.confidence === "low")
                        );
                    })
                    .map(detail => {
                        let pattern = detail.matchedPattern;
                        pattern = sanitizeSensitiveInfo(pattern);
                        if (containsSensitiveInfo(pattern)) {
                            pattern = "[REDACTED_PATTERN]";
                        }
                        if (pattern.length > SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) {
                            pattern = pattern.substring(0, SAVE_ANALYSIS_LIMITS.MAX_PATTERN_LENGTH) + "...";
                        }
                        return { ...detail, matchedPattern: pattern };
                    })
                : [];
            const identifiedPlatforms = Array.isArray(data.identifiedPlatforms)
                ? data.identifiedPlatforms.filter((p): p is string => typeof p === "string")
                : [];
            const risks = Array.isArray(data.risks)
                ? data.risks.filter((r): r is RiskItem => {
                    if (!r || typeof r !== "object" || Array.isArray(r)) {
                        return false;
                    }
                    return (
                        typeof r.id === "string" &&
                        typeof r.severity === "string" &&
                        typeof r.name === "string" &&
                        typeof r.description === "string"
                    );
                })
                : [];
            const riskScore = typeof data.riskScore === "number" && !isNaN(data.riskScore)
                ? Math.max(0, Math.min(100, data.riskScore))
                : 0;
            const recommendations = Array.isArray(data.recommendations)
                ? data.recommendations.filter((r): r is string => typeof r === "string")
                : [];
            const analysisData: ScriptAnalysisResult = {
                identifiedPlatforms,
                platformDetails: sanitizedPlatformDetails,
                risks,
                riskScore,
                recommendations,
            };
            const createdAssets = [];
            const failedAssets: string[] = [];
            for (const platform of analysisData.identifiedPlatforms) {
                const detectedPatterns = analysisData.platformDetails
                    .filter(d => d.platform === platform)
                    .slice(0, SAVE_ANALYSIS_LIMITS.MAX_DETECTED_PATTERNS)
                    .map(d => d.matchedPattern);
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "pixel",
                    platform,
                    displayName: t("scan.action.manualPasteLabel", { platform }),
                    riskLevel: "high",
                    suggestedMigration: "web_pixel",
                    details: {
                        source: "manual_paste",
                        analysisRiskScore: analysisData.riskScore,
                        detectedPatterns,
                    },
                });
                if (asset) {
                    createdAssets.push(asset);
                } else {
                    failedAssets.push(platform);
                    logger.warn("Failed to create AuditAsset for platform", {
                        shopId: shop.id,
                        platform,
                        actionType: "save_analysis"
                    });
                }
            }
            if (analysisData.identifiedPlatforms.length === 0) {
                const risksForDetails = analysisData.risks.slice(0, SAVE_ANALYSIS_LIMITS.MAX_RISKS_IN_DETAILS);
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "other",
                    displayName: t("scan.action.unidentifiedScript"),
                    riskLevel: analysisData.riskScore > 60 ? "high" : analysisData.riskScore > 30 ? "medium" : "low",
                    suggestedMigration: "none",
                    details: {
                        source: "manual_paste",
                        analysisRiskScore: analysisData.riskScore,
                        risks: risksForDetails,
                    },
                });
                if (asset) {
                    createdAssets.push(asset);
                } else {
                    failedAssets.push(t("scan.action.unidentifiedScript"));
                    logger.warn("Failed to create AuditAsset for unidentified script", {
                        shopId: shop.id,
                        actionType: "save_analysis"
                    });
                }
            }
            if (failedAssets.length > 0) {
                logger.warn("Some assets failed to create", {
                    shopId: shop.id,
                    failedCount: failedAssets.length,
                    failedPlatforms: failedAssets,
                    actionType: "save_analysis"
                });
            }
            return json({
                success: true,
                actionType: "save_analysis",
                savedCount: createdAssets.length,
                message: createdAssets.length > 0
                    ? t("scan.action.savedAssets", { count: createdAssets.length }) + (failedAssets.length > 0 ? t("scan.action.failedSuffix", { count: failedAssets.length }) : '')
                    : t("scan.action.saveFailed"),
                ...(failedAssets.length > 0 && { warning: t("scan.action.assetSavePartialFail", { count: failedAssets.length }) })
            });
        } catch (error) {
            const randomBytes = new Uint8Array(4);
            globalThis.crypto.getRandomValues(randomBytes);
            const errorId = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
            logger.error("Save analysis error", {
                errorId,
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                actionType: "save_analysis"
            });
            return json({
                error: t("scan.action.saveError"),
                errorId
            }, { status: 500 });
        }
    }
    if (actionType === "create_from_wizard") {
        try {
            const assetsStr = formData.get("assets") as string;
            if (!assetsStr) {
                return json({ error: t("scan.action.missingAssetData") }, { status: 400 });
            }
            let assets: AuditAssetInput[];
            try {
                const parsed = JSON.parse(assetsStr);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    return json({ error: t("scan.action.assetDataMustBeArray") }, { status: 400 });
                }
                assets = parsed as AuditAssetInput[];
            } catch {
                return json({ error: t("scan.action.invalidAssetDataFormat") }, { status: 400 });
            }
            const result = await batchCreateAuditAssets(shop.id, assets);
            return json({
                success: true,
                actionType: "create_from_wizard",
                message: t("scan.action.createdAssets", { count: result.created }) + (result.updated > 0 ? t("scan.action.updatedSuffix", { count: result.updated }) : '') + (result.failed > 0 ? t("scan.action.failedSuffix", { count: result.failed }) : ''),
                created: result.created,
                updated: result.updated,
                failed: result.failed,
            });
        } catch (error) {
            logger.error("Create from wizard error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: t("scan.action.createError") }, { status: 500 });
        }
    }
    if (actionType === "mark_asset_complete") {
        try {
            const assetId = formData.get("assetId") as string;
            if (!assetId) {
                return json({ error: t("scan.action.missingAssetId") }, { status: 400 });
            }
            const asset = await prisma.auditAsset.findUnique({
                where: { id: assetId },
                select: { shopId: true, migrationStatus: true },
            });
            if (!asset) {
                return json({ error: t("scan.action.assetNotFound") }, { status: 404 });
            }
            if (asset.shopId !== shop.id) {
                return json({ error: t("scan.action.assetAccessDenied") }, { status: 403 });
            }
            await prisma.auditAsset.update({
                where: { id: assetId },
                data: {
                    migrationStatus: "completed",
                    migratedAt: new Date(),
                },
            });
            return json({
                success: true,
                actionType: "mark_asset_complete",
                message: t("scan.action.markedComplete"),
            });
        } catch (error) {
            logger.error("Mark asset complete error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: t("scan.action.markError") }, { status: 500 });
        }
    }
    if (actionType === "export_checklist_csv") {
        try {
            const checklist = await generateMigrationChecklist(shop.id);
            const formatEstimatedTime = (minutes: number) => {
                if (minutes < 60) {
                    return `${minutes} ${t("scan.csv.minutes")}`;
                }
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return mins > 0 
                    ? `${hours} ${t("scan.csv.hours")} ${mins} ${t("scan.csv.minutes")}` 
                    : `${hours} ${t("scan.csv.hours")}`;
            };
            const migrationTypeLabels: Record<string, string> = {
                web_pixel: t("scan.csv.migrationTypes.web_pixel"),
                ui_extension: t("scan.csv.migrationTypes.ui_extension"),
                server_side: t("scan.csv.migrationTypes.server_side"),
                none: t("scan.csv.migrationTypes.none"),
            };
            const csvLines: string[] = [];
            csvLines.push(t("scan.csv.title"));
            csvLines.push(`${t("scan.csv.shop")}: ${shopDomain}`);
            
            const locale = await i18nServer.getLocale(request);
            const dateStr = new Date().toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US');
            csvLines.push(`${t("scan.csv.generatedAt")}: ${dateStr}`);
            
            csvLines.push(`${t("scan.csv.totalItems")}: ${checklist.totalItems}`);
            csvLines.push(`${t("scan.csv.highRisk")}: ${checklist.highPriorityItems}`);
            csvLines.push(`${t("scan.csv.mediumRisk")}: ${checklist.mediumPriorityItems}`);
            csvLines.push(`${t("scan.csv.lowRisk")}: ${checklist.lowPriorityItems}`);
            csvLines.push(`${t("scan.csv.estimatedTime")}: ${Math.floor(checklist.estimatedTotalTime / 60)} ${t("scan.csv.hours")} ${checklist.estimatedTotalTime % 60} ${t("scan.csv.minutes")}`);
            csvLines.push("");
            csvLines.push(`${t("scan.csv.headers.assetName")},${t("scan.csv.headers.riskLevel")},${t("scan.csv.headers.migrationPath")},${t("scan.csv.headers.estimatedTimeAndInfo")}`);
            checklist.items.forEach((item) => {
                const fingerprint = item.fingerprint ? `(${item.fingerprint.substring(0, 8)}...)` : "";
                const assetName = `${item.title} ${fingerprint}`.trim();
                
                const riskReasonText = item.riskReasonKey 
                    ? t(item.riskReasonKey, item.riskReasonParams) 
                    : item.riskReason;
                const riskDisplay = `${item.riskLevel} - ${riskReasonText}`;
                
                const migrationPath = migrationTypeLabels[item.suggestedMigration] || item.suggestedMigration;
                
                let requiredInfoText = item.requiredInfo;
                if (item.requiredInfoKeys && item.requiredInfoKeys.length > 0) {
                    requiredInfoText = item.requiredInfoKeys.map(k => t(k.key, k.params)).join("; ");
                }
                
                const timeAndInfo = `${formatEstimatedTime(item.estimatedTime)} | ${requiredInfoText}`;
                const row = [
                    assetName,
                    riskDisplay,
                    migrationPath,
                    timeAndInfo,
                ];
                csvLines.push(row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","));
            });
            const csvContent = csvLines.join("\n");
            const filename = `migration_checklist_${shopDomain}_${new Date().toISOString().split("T")[0]}.csv`;
            return new Response(csvContent, {
                status: 200,
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="${sanitizeFilename(filename)}"`,
                },
            });
        } catch (error) {
            logger.error("Export checklist CSV error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: t("scan.action.exportError") }, { status: 500 });
        }
    }
    if (actionType && actionType !== "scan") {
        return json({ error: t("scan.action.unsupportedAction") }, { status: 400 });
    }
    try {
        const scanResult = await scanShopTracking(admin, shop.id, { t });
        return json({
            success: true,
            actionType: "scan",
            result: scanResult,
            partialRefresh: scanResult._partialRefresh || false,
        });
    }
    catch (error) {
        logger.error("Scan error", error);
        return json({ error: error instanceof Error ? error.message : "Scan failed" }, { status: 500 });
    }
};
