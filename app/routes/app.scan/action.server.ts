import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { scanShopTracking, type ScriptAnalysisResult } from "../../services/scanner.server";
import { createAuditAsset, batchCreateAuditAssets, type AuditAssetInput } from "../../services/audit-asset.server";
import { generateMigrationChecklist } from "../../services/migration-checklist.server";
import { SAVE_ANALYSIS_LIMITS, PLATFORM_NAME_REGEX } from "../../utils/scan-constants";
import { checkSensitiveInfoInData } from "../../utils/scan-validation";
import { containsSensitiveInfo, sanitizeSensitiveInfo } from "../../utils/security";
import { sanitizeFilename } from "../../utils/responses";
import { logger } from "../../utils/logger.server";
import { getLocaleFromRequest } from "../../utils/locale.server";
import type { RiskItem } from "../../types";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { session, admin } = await authenticate.admin(request);
    const locale = getLocaleFromRequest(request);
    const isZh = locale === "zh";
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
        where: { shopDomain },
    });
    if (!shop) {
        return json({ error: "Shop not found" }, { status: 404 });
    }
    const formData = await request.formData();
    const actionType = formData.get("_action");
    if (actionType === "save_analysis") {
        try {
            const analysisDataStr = formData.get("analysisData") as string;
            if (!analysisDataStr) {
                return json({ error: isZh ? "缺少分析数据" : "Missing analysis data" }, { status: 400 });
            }
            if (analysisDataStr.length > SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE) {
                logger.warn("Analysis data too large", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    maxSize: SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE
                });
                return json({
                    error: isZh ? `分析数据过大（最大 ${SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE / 1024}KB）` : `Analysis data too large (max ${SAVE_ANALYSIS_LIMITS.MAX_INPUT_SIZE / 1024}KB)`
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
                return json({ error: isZh ? "无法解析分析数据：无效的 JSON 格式" : "Invalid JSON format for analysis data" }, { status: 400 });
            }
            if (!parsedData || typeof parsedData !== "object") {
                return json({ error: isZh ? "无效的分析数据格式：必须是对象" : "Invalid analysis data format: must be object" }, { status: 400 });
            }
            const data = parsedData as Record<string, unknown>;
            if (checkSensitiveInfoInData(parsedData)) {
                logger.warn("Analysis data contains potential sensitive information", {
                    shopId: shop.id,
                    contentLength: analysisDataStr.length,
                    actionType: "save_analysis"
                });
                return json({
                    error: isZh ? "检测到可能包含敏感信息的内容（如 API keys、tokens、客户信息等）。请先脱敏后再保存。" : "Content may contain sensitive information (e.g. API keys, tokens). Please redact before saving."
                }, { status: 400 });
            }
            if (!Array.isArray(data.identifiedPlatforms)) {
                return json({ error: isZh ? "无效的分析数据格式：identifiedPlatforms 必须是数组" : "Invalid format: identifiedPlatforms must be array" }, { status: 400 });
            }
            if (!Array.isArray(data.platformDetails)) {
                return json({ error: isZh ? "无效的分析数据格式：platformDetails 必须是数组" : "Invalid format: platformDetails must be array" }, { status: 400 });
            }
            if (!Array.isArray(data.risks)) {
                return json({ error: isZh ? "无效的分析数据格式：risks 必须是数组" : "Invalid format: risks must be array" }, { status: 400 });
            }
            if (!Array.isArray(data.recommendations)) {
                return json({ error: isZh ? "无效的分析数据格式：recommendations 必须是数组" : "Invalid format: recommendations must be array" }, { status: 400 });
            }
            if (data.identifiedPlatforms.length > SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS) {
                return json({
                    error: isZh ? `identifiedPlatforms 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS} 个）` : `identifiedPlatforms array too long (max ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORMS})`
                }, { status: 400 });
            }
            if (data.platformDetails.length > SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS) {
                return json({
                    error: isZh ? `platformDetails 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS} 个）` : `platformDetails array too long (max ${SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_DETAILS})`
                }, { status: 400 });
            }
            if (data.risks.length > SAVE_ANALYSIS_LIMITS.MAX_RISKS) {
                return json({
                    error: isZh ? `risks 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_RISKS} 个）` : `risks array too long (max ${SAVE_ANALYSIS_LIMITS.MAX_RISKS})`
                }, { status: 400 });
            }
            if (data.recommendations.length > SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS) {
                return json({
                    error: isZh ? `recommendations 数组过长（最多 ${SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS} 个）` : `recommendations array too long (max ${SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATIONS})`
                }, { status: 400 });
            }
            if (
                typeof data.riskScore !== "number" ||
                !Number.isFinite(data.riskScore) ||
                !Number.isInteger(data.riskScore) ||
                data.riskScore < SAVE_ANALYSIS_LIMITS.MIN_RISK_SCORE ||
                data.riskScore > SAVE_ANALYSIS_LIMITS.MAX_RISK_SCORE
            ) {
                return json({
                    error: isZh ? "无效的分析数据格式：riskScore 必须是 0-100 之间的整数" : "Invalid format: riskScore must be integer 0-100"
                }, { status: 400 });
            }
            if (!data.identifiedPlatforms.every((p: unknown) => {
                return (
                    typeof p === "string" &&
                    p.length >= SAVE_ANALYSIS_LIMITS.MIN_PLATFORM_NAME_LENGTH &&
                    p.length <= SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_NAME_LENGTH &&
                    PLATFORM_NAME_REGEX.test(p)
                );
            })) {
                return json({
                    error: `无效的分析数据格式：identifiedPlatforms 中的元素必须是有效的平台名称（小写字母、数字、下划线，${SAVE_ANALYSIS_LIMITS.MIN_PLATFORM_NAME_LENGTH}-${SAVE_ANALYSIS_LIMITS.MAX_PLATFORM_NAME_LENGTH}字符）`
                }, { status: 400 });
            }
            if (!data.platformDetails.every((p: unknown) => {
                if (typeof p !== "object" || p === null || Array.isArray(p)) return false;
                const detail = p as Record<string, unknown>;
                return (
                    typeof detail.platform === "string" &&
                    typeof detail.type === "string" &&
                    typeof detail.confidence === "string" &&
                    (detail.confidence === "high" || detail.confidence === "medium" || detail.confidence === "low") &&
                    typeof detail.matchedPattern === "string"
                );
            })) {
                return json({ error: isZh ? "无效的分析数据格式：platformDetails 中的元素结构不正确" : "Invalid format: platformDetails element structure" }, { status: 400 });
            }
            if (!data.risks.every((r: unknown) => {
                if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
                const risk = r as Record<string, unknown>;
                return (
                    typeof risk.id === "string" &&
                    typeof risk.name === "string" &&
                    typeof risk.description === "string" &&
                    typeof risk.severity === "string" &&
                    (risk.severity === "high" || risk.severity === "medium" || risk.severity === "low")
                );
            })) {
                return json({ error: isZh ? "无效的分析数据格式：risks 中的元素结构不正确" : "Invalid format: risks element structure" }, { status: 400 });
            }
            if (!data.recommendations.every((r: unknown) => {
                return (
                    typeof r === "string" &&
                    r.length > 0 &&
                    r.length <= SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATION_LENGTH
                );
            })) {
                return json({
                    error: `无效的分析数据格式：recommendations 中的元素必须是长度 1-${SAVE_ANALYSIS_LIMITS.MAX_RECOMMENDATION_LENGTH} 的字符串`
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
                        typeof r.title === "string" &&
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
                    displayName: `手动粘贴: ${platform}`,
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
            if (analysisData.identifiedPlatforms.length === 0 && analysisData.riskScore > 0) {
                const risksForDetails = analysisData.risks.slice(0, SAVE_ANALYSIS_LIMITS.MAX_RISKS_IN_DETAILS);
                const asset = await createAuditAsset(shop.id, {
                    sourceType: "manual_paste",
                    category: "other",
                    displayName: "未识别的脚本",
                    riskLevel: analysisData.riskScore > 60 ? "high" : "medium",
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
                    failedAssets.push("未识别的脚本");
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
                    ? (isZh ? `已保存 ${createdAssets.length} 个审计资产记录${failedAssets.length > 0 ? `，${failedAssets.length} 个失败` : ''}` : `Saved ${createdAssets.length} audit assets${failedAssets.length > 0 ? `, ${failedAssets.length} failed` : ''}`)
                    : (isZh ? "保存失败，请检查日志" : "Save failed. Check logs"),
                ...(failedAssets.length > 0 && { warning: isZh ? `${failedAssets.length} 个资产保存失败` : `${failedAssets.length} assets failed to save` })
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
                error: isZh ? "保存失败，请稍后重试" : "Save failed. Please try again later",
                errorId
            }, { status: 500 });
        }
    }
    if (actionType === "create_from_wizard") {
        try {
            const assetsStr = formData.get("assets") as string;
            if (!assetsStr) {
                return json({ error: isZh ? "缺少资产数据" : "Missing asset data" }, { status: 400 });
            }
            let assets: AuditAssetInput[];
            try {
                const parsed = JSON.parse(assetsStr);
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    return json({ error: isZh ? "资产数据必须是非空数组" : "Asset data must be non-empty array" }, { status: 400 });
                }
                assets = parsed as AuditAssetInput[];
            } catch {
                return json({ error: isZh ? "无效的资产数据格式" : "Invalid asset data format" }, { status: 400 });
            }
            const result = await batchCreateAuditAssets(shop.id, assets);
            return json({
                success: true,
                actionType: "create_from_wizard",
                message: isZh ? `已创建 ${result.created} 个审计资产记录${result.updated > 0 ? `，更新 ${result.updated} 个` : ''}${result.failed > 0 ? `，${result.failed} 个失败` : ''}` : `Created ${result.created} audit assets${result.updated > 0 ? `, updated ${result.updated}` : ''}${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
                created: result.created,
                updated: result.updated,
                failed: result.failed,
            });
        } catch (error) {
            logger.error("Create from wizard error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: isZh ? "创建失败，请稍后重试" : "Create failed. Please try again later" }, { status: 500 });
        }
    }
    if (actionType === "mark_asset_complete") {
        try {
            const assetId = formData.get("assetId") as string;
            if (!assetId) {
                return json({ error: isZh ? "缺少资产 ID" : "Missing asset ID" }, { status: 400 });
            }
            const asset = await prisma.auditAsset.findUnique({
                where: { id: assetId },
                select: { shopId: true, migrationStatus: true },
            });
            if (!asset) {
                return json({ error: isZh ? "资产不存在" : "Asset not found" }, { status: 404 });
            }
            if (asset.shopId !== shop.id) {
                return json({ error: isZh ? "无权访问此资产" : "Access denied to this asset" }, { status: 403 });
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
                message: isZh ? "已标记为已完成" : "Marked as completed",
            });
        } catch (error) {
            logger.error("Mark asset complete error", {
                shopId: shop.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: isZh ? "标记失败，请稍后重试" : "Mark failed. Please try again later" }, { status: 500 });
        }
    }
    if (actionType === "export_checklist_csv") {
        try {
            const dateLocale = locale === "zh" ? "zh-CN" : "en";
            const checklist = await generateMigrationChecklist(shop.id);
            const formatEstimatedTime = (minutes: number) => {
                if (minutes < 60) {
                    return `${minutes} 分钟`;
                }
                const hours = Math.floor(minutes / 60);
                const mins = minutes % 60;
                return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
            };
            const migrationTypeLabels: Record<string, string> = {
                web_pixel: "Web Pixel",
                ui_extension: "手动迁移",
                server_side: "Not available",
                none: "External redirect / not supported",
            };
            const csvLines: string[] = [];
            csvLines.push("迁移清单");
            csvLines.push(`店铺: ${shopDomain}`);
            csvLines.push(`生成时间: ${new Date().toLocaleString(dateLocale)}`);
            csvLines.push(`待迁移项: ${checklist.totalItems}`);
            csvLines.push(`高风险项: ${checklist.highPriorityItems}`);
            csvLines.push(`中风险项: ${checklist.mediumPriorityItems}`);
            csvLines.push(`低风险项: ${checklist.lowPriorityItems}`);
            csvLines.push(`预计总时间: ${Math.floor(checklist.estimatedTotalTime / 60)} 小时 ${checklist.estimatedTotalTime % 60} 分钟`);
            csvLines.push("");
            csvLines.push("资产名称/指纹,风险等级+原因,推荐迁移路径,预估工时+需要的信息");
            checklist.items.forEach((item) => {
                const fingerprint = item.fingerprint ? `(${item.fingerprint.substring(0, 8)}...)` : "";
                const assetName = `${item.title} ${fingerprint}`.trim();
                const riskDisplay = `${item.riskLevel} - ${item.riskReason}`;
                const migrationPath = migrationTypeLabels[item.suggestedMigration] || item.suggestedMigration;
                const timeAndInfo = `${formatEstimatedTime(item.estimatedTime)} | ${item.requiredInfo}`;
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
            return json({ error: isZh ? "导出失败，请稍后重试" : "Export failed. Please try again later" }, { status: 500 });
        }
    }
    if (actionType && actionType !== "scan") {
        return json({ error: isZh ? "不支持的操作类型" : "Unsupported action type" }, { status: 400 });
    }
    try {
        const scanResult = await scanShopTracking(admin, shop.id);
        return json({
            success: true,
            actionType: "scan",
            result: scanResult,
            partialRefresh: scanResult._partialRefresh || false,
        });
    }
    catch (error) {
        logger.error("Scan error", error);
        return json({ error: error instanceof Error ? error.message : (isZh ? "扫描失败" : "Scan failed") }, { status: 500 });
    }
};
