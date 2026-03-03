import { randomBytes, randomUUID } from "crypto";
import prisma from "../db.server";
import { hashValueSync } from "../utils/crypto.server";
import { generateVerificationReportData, type VerificationReportData } from "./verification-report.server";
import { normalizePlanId, planSupportsReportExport, type PlanId } from "./billing/plans";

const DEFAULT_EXPIRY_DAYS = 3;
const MAX_EXPIRY_DAYS = 30;
const DEFAULT_MAX_ACCESS_COUNT = 20;
const MAX_ACCESS_COUNT = 200;
const TOKEN_BYTES = 24;

export interface ReportShareLinkMeta {
  id: string;
  runId: string;
  tokenPrefix: string;
  expiresAt: Date;
  maxAccessCount: number | null;
  remainingAccessCount: number | null;
  revokedAt: Date | null;
  createdAt: Date;
  accessCount: number;
}

export interface ScanReportShareLinkMeta {
  id: string;
  scanReportId: string;
  tokenPrefix: string;
  expiresAt: Date;
  maxAccessCount: number | null;
  remainingAccessCount: number | null;
  revokedAt: Date | null;
  createdAt: Date;
  accessCount: number;
}

export interface CreatedReportShareLink {
  id: string;
  token: string;
  tokenPrefix: string;
  expiresAt: Date;
  createdAt: Date;
  maxAccessCount: number;
}

export interface PublicVerificationReportData {
  runId: string;
  runName: string;
  runType: VerificationReportData["runType"];
  status: string;
  platforms: string[];
  summary: VerificationReportData["summary"];
  platformResults: VerificationReportData["platformResults"];
  events: Array<{
    eventType: string;
    platform: string;
    orderId?: string;
    status: string;
    params?: {
      value?: number;
      currency?: string;
    };
    discrepancies?: string[];
    errors?: string[];
    sandboxLimitations?: string[];
  }>;
  reconciliation?: VerificationReportData["reconciliation"];
  completedAt?: Date;
  createdAt: Date;
  share: {
    tokenPrefix: string;
    expiresAt: Date;
  };
}

export interface PublicScanReportData {
  reportId: string;
  riskScore: number;
  status: string;
  identifiedPlatforms: string[];
  riskItems: Array<{
    id: string;
    name: string;
    severity: string;
    platform?: string;
    description?: string;
    recommendation?: string;
  }>;
  createdAt: Date;
  completedAt?: Date;
  share: {
    tokenPrefix: string;
    expiresAt: Date;
  };
}

function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function clampExpiryDays(expiresInDays?: number): number {
  if (!expiresInDays || !Number.isFinite(expiresInDays)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.floor(expiresInDays)));
}

function clampAccessCount(maxAccessCount?: number): number {
  if (!maxAccessCount || !Number.isFinite(maxAccessCount)) return DEFAULT_MAX_ACCESS_COUNT;
  return Math.min(MAX_ACCESS_COUNT, Math.max(1, Math.floor(maxAccessCount)));
}

function getRemainingAccessCount(accessCount: number, maxAccessCount: number | null): number | null {
  if (maxAccessCount == null) return null;
  return Math.max(0, maxAccessCount - accessCount);
}

function redactOrderId(orderId?: string): string | undefined {
  if (!orderId) return undefined;
  const trimmed = orderId.trim();
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function toPublicReportData(
  reportData: VerificationReportData,
  shareMeta: { tokenPrefix: string; expiresAt: Date }
): PublicVerificationReportData {
  return {
    runId: reportData.runId,
    runName: reportData.runName,
    runType: reportData.runType,
    status: reportData.status,
    platforms: reportData.platforms,
    summary: reportData.summary,
    platformResults: reportData.platformResults,
    events: reportData.events.slice(0, 100).map((event) => ({
      eventType: event.eventType,
      platform: event.platform,
      orderId: redactOrderId(event.orderId),
      status: event.status,
      params: event.params,
      discrepancies: event.discrepancies,
      errors: event.errors,
      sandboxLimitations: event.sandboxLimitations,
    })),
    reconciliation: reportData.reconciliation,
    completedAt: reportData.completedAt,
    createdAt: reportData.createdAt,
    share: {
      tokenPrefix: shareMeta.tokenPrefix,
      expiresAt: shareMeta.expiresAt,
    },
  };
}

function toPublicScanReportData(
  scanReport: {
    id: string;
    riskScore: number;
    status: string;
    identifiedPlatforms: unknown;
    riskItems: unknown;
    createdAt: Date;
    completedAt: Date | null;
  },
  shareMeta: { tokenPrefix: string; expiresAt: Date }
): PublicScanReportData {
  const identifiedPlatforms = Array.isArray(scanReport.identifiedPlatforms)
    ? scanReport.identifiedPlatforms.filter((platform): platform is string => typeof platform === "string")
    : [];
  const riskItems = Array.isArray(scanReport.riskItems)
    ? scanReport.riskItems
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null && !Array.isArray(item)
        )
        .slice(0, 100)
        .map((item, index) => ({
          id: typeof item.id === "string" ? item.id : `risk-${index + 1}`,
          name: typeof item.name === "string" ? item.name : "Unknown",
          severity: typeof item.severity === "string" ? item.severity : "medium",
          platform: typeof item.platform === "string" ? item.platform : undefined,
          description: typeof item.description === "string" ? item.description : undefined,
          recommendation: typeof item.recommendation === "string" ? item.recommendation : undefined,
        }))
    : [];
  return {
    reportId: scanReport.id,
    riskScore: scanReport.riskScore,
    status: scanReport.status,
    identifiedPlatforms,
    riskItems,
    createdAt: scanReport.createdAt,
    completedAt: scanReport.completedAt || undefined,
    share: {
      tokenPrefix: shareMeta.tokenPrefix,
      expiresAt: shareMeta.expiresAt,
    },
  };
}

export async function createVerificationReportShareLink(params: {
  shopId: string;
  runId: string;
  createdBy?: string | null;
  expiresInDays?: number;
  maxAccessCount?: number;
}): Promise<CreatedReportShareLink> {
  const { shopId, runId, createdBy, expiresInDays, maxAccessCount } = params;
  const run = await prisma.verificationRun.findFirst({
    where: { id: runId, shopId },
    select: { id: true },
  });
  if (!run) {
    throw new Error("Verification report not found");
  }
  const expiryDays = clampExpiryDays(expiresInDays);
  const accessLimit = clampAccessCount(maxAccessCount);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateShareToken();
    const tokenHash = hashValueSync(token);
    try {
      const created = await prisma.reportShareLink.create({
        data: {
          id: randomUUID(),
          shopId,
          runId,
          tokenHash,
          tokenPrefix: token.slice(0, 8),
          scope: "verification_report",
          expiresAt,
          maxAccessCount: accessLimit,
          createdBy: createdBy || null,
        },
        select: {
          id: true,
          tokenPrefix: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      return {
        id: created.id,
        token,
        tokenPrefix: created.tokenPrefix,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
        maxAccessCount: accessLimit,
      };
    } catch (error: any) {
      if (error?.code === "P2002" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate share link");
}

export async function revokeVerificationReportShareLinks(shopId: string, runId: string): Promise<number> {
  const result = await prisma.reportShareLink.updateMany({
    where: {
      shopId,
      runId,
      scope: "verification_report",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });
  return result.count ?? 0;
}

export async function getLatestVerificationReportShareMeta(
  shopId: string,
  runId: string
): Promise<ReportShareLinkMeta | null> {
  const record = await prisma.reportShareLink.findFirst({
    where: {
      shopId,
      runId,
      scope: "verification_report",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      runId: true,
      tokenPrefix: true,
      expiresAt: true,
      maxAccessCount: true,
      revokedAt: true,
      createdAt: true,
      accessCount: true,
    },
  });
  if (!record || !record.runId) return null;
  return {
    id: record.id,
    runId: record.runId,
    tokenPrefix: record.tokenPrefix,
    expiresAt: record.expiresAt,
    maxAccessCount: record.maxAccessCount,
    remainingAccessCount: getRemainingAccessCount(record.accessCount, record.maxAccessCount),
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    accessCount: record.accessCount,
  };
}

export async function resolvePublicVerificationReportByToken(
  token: string
): Promise<PublicVerificationReportData | null> {
  const tokenHash = hashValueSync(token);
  const shareLink = await prisma.reportShareLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      shopId: true,
      runId: true,
      tokenPrefix: true,
      expiresAt: true,
      maxAccessCount: true,
      accessCount: true,
      revokedAt: true,
      scope: true,
    },
  });
  if (!shareLink) return null;
  if (shareLink.scope !== "verification_report") return null;
  if (shareLink.revokedAt) return null;
  const now = new Date();
  if (shareLink.expiresAt.getTime() <= now.getTime()) return null;
  if (
    typeof shareLink.maxAccessCount === "number" &&
    shareLink.maxAccessCount > 0 &&
    shareLink.accessCount >= shareLink.maxAccessCount
  ) {
    return null;
  }
  if (!shareLink.runId) return null;
  const shop = await prisma.shop.findUnique({
    where: { id: shareLink.shopId },
    select: { plan: true },
  });
  const currentPlan = normalizePlanId((shop?.plan || "free") as string) as PlanId;
  if (!planSupportsReportExport(currentPlan)) {
    return null;
  }
  const incremented = await prisma.reportShareLink.updateMany({
    where: {
      id: shareLink.id,
      revokedAt: null,
      expiresAt: { gt: now },
      OR: [{ maxAccessCount: null }, { accessCount: { lt: shareLink.maxAccessCount ?? 0 } }],
    },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: now,
    },
  });
  if ((incremented.count ?? 0) < 1) {
    return null;
  }
  const reportData = await generateVerificationReportData(shareLink.shopId, shareLink.runId);
  return toPublicReportData(reportData, {
    tokenPrefix: shareLink.tokenPrefix,
    expiresAt: shareLink.expiresAt,
  });
}

export async function createScanReportShareLink(params: {
  shopId: string;
  reportId: string;
  createdBy?: string | null;
  expiresInDays?: number;
  maxAccessCount?: number;
}): Promise<CreatedReportShareLink> {
  const { shopId, reportId, createdBy, expiresInDays, maxAccessCount } = params;
  const report = await prisma.scanReport.findFirst({
    where: { id: reportId, shopId },
    select: { id: true },
  });
  if (!report) {
    throw new Error("Scan report not found");
  }
  const expiryDays = clampExpiryDays(expiresInDays);
  const accessLimit = clampAccessCount(maxAccessCount);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateShareToken();
    const tokenHash = hashValueSync(token);
    try {
      const created = await prisma.reportShareLink.create({
        data: {
          id: randomUUID(),
          shopId,
          scanReportId: reportId,
          tokenHash,
          tokenPrefix: token.slice(0, 8),
          scope: "scan_report",
          expiresAt,
          maxAccessCount: accessLimit,
          createdBy: createdBy || null,
        },
        select: {
          id: true,
          tokenPrefix: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      return {
        id: created.id,
        token,
        tokenPrefix: created.tokenPrefix,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
        maxAccessCount: accessLimit,
      };
    } catch (error: any) {
      if (error?.code === "P2002" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate share link");
}

export async function revokeScanReportShareLinks(shopId: string, reportId: string): Promise<number> {
  const result = await prisma.reportShareLink.updateMany({
    where: {
      shopId,
      scanReportId: reportId,
      scope: "scan_report",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { revokedAt: new Date() },
  });
  return result.count ?? 0;
}

export async function getLatestScanReportShareMeta(
  shopId: string,
  reportId: string
): Promise<ScanReportShareLinkMeta | null> {
  const record = await prisma.reportShareLink.findFirst({
    where: {
      shopId,
      scanReportId: reportId,
      scope: "scan_report",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      scanReportId: true,
      tokenPrefix: true,
      expiresAt: true,
      maxAccessCount: true,
      revokedAt: true,
      createdAt: true,
      accessCount: true,
    },
  });
  if (!record) return null;
  return {
    id: record.id,
    scanReportId: record.scanReportId || reportId,
    tokenPrefix: record.tokenPrefix,
    expiresAt: record.expiresAt,
    maxAccessCount: record.maxAccessCount,
    remainingAccessCount: getRemainingAccessCount(record.accessCount, record.maxAccessCount),
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
    accessCount: record.accessCount,
  };
}

export async function resolvePublicScanReportByToken(
  token: string
): Promise<PublicScanReportData | null> {
  const tokenHash = hashValueSync(token);
  const shareLink = await prisma.reportShareLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      shopId: true,
      scanReportId: true,
      tokenPrefix: true,
      expiresAt: true,
      maxAccessCount: true,
      accessCount: true,
      revokedAt: true,
      scope: true,
    },
  });
  if (!shareLink) return null;
  if (shareLink.scope !== "scan_report") return null;
  if (shareLink.revokedAt) return null;
  const now = new Date();
  if (shareLink.expiresAt.getTime() <= now.getTime()) return null;
  if (
    typeof shareLink.maxAccessCount === "number" &&
    shareLink.maxAccessCount > 0 &&
    shareLink.accessCount >= shareLink.maxAccessCount
  ) {
    return null;
  }
  if (!shareLink.scanReportId) return null;
  const incremented = await prisma.reportShareLink.updateMany({
    where: {
      id: shareLink.id,
      revokedAt: null,
      expiresAt: { gt: now },
      OR: [{ maxAccessCount: null }, { accessCount: { lt: shareLink.maxAccessCount ?? 0 } }],
    },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: now,
    },
  });
  if ((incremented.count ?? 0) < 1) {
    return null;
  }
  const scanReport = await prisma.scanReport.findFirst({
    where: {
      id: shareLink.scanReportId,
      shopId: shareLink.shopId,
    },
    select: {
      id: true,
      riskScore: true,
      status: true,
      identifiedPlatforms: true,
      riskItems: true,
      createdAt: true,
      completedAt: true,
    },
  });
  if (!scanReport) return null;
  return toPublicScanReportData(scanReport, {
    tokenPrefix: shareLink.tokenPrefix,
    expiresAt: shareLink.expiresAt,
  });
}
