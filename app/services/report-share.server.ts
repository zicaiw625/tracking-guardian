import { randomBytes, randomUUID } from "crypto";
import prisma from "../db.server";
import { hashValueSync } from "../utils/crypto.server";
import { generateVerificationReportData, type VerificationReportData } from "./verification-report.server";
import { normalizePlanId, planSupportsReportExport, type PlanId } from "./billing/plans";

const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 90;
const TOKEN_BYTES = 24;

export interface ReportShareLinkMeta {
  id: string;
  runId: string;
  tokenPrefix: string;
  expiresAt: Date;
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

function generateShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function clampExpiryDays(expiresInDays?: number): number {
  if (!expiresInDays || !Number.isFinite(expiresInDays)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.floor(expiresInDays)));
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

export async function createVerificationReportShareLink(params: {
  shopId: string;
  runId: string;
  createdBy?: string | null;
  expiresInDays?: number;
}): Promise<CreatedReportShareLink> {
  const { shopId, runId, createdBy, expiresInDays } = params;
  const run = await prisma.verificationRun.findFirst({
    where: { id: runId, shopId },
    select: { id: true },
  });
  if (!run) {
    throw new Error("Verification report not found");
  }
  const expiryDays = clampExpiryDays(expiresInDays);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateShareToken();
    const tokenHash = hashValueSync(token);
    try {
      const created = await (prisma as any).reportShareLink.create({
        data: {
          id: randomUUID(),
          shopId,
          runId,
          tokenHash,
          tokenPrefix: token.slice(0, 8),
          scope: "verification_report",
          expiresAt,
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
  const result = await (prisma as any).reportShareLink.updateMany({
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
  return await (prisma as any).reportShareLink.findFirst({
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
      revokedAt: true,
      createdAt: true,
      accessCount: true,
    },
  });
}

export async function resolvePublicVerificationReportByToken(
  token: string
): Promise<PublicVerificationReportData | null> {
  const tokenHash = hashValueSync(token);
  const shareLink = await (prisma as any).reportShareLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      shopId: true,
      runId: true,
      tokenPrefix: true,
      expiresAt: true,
      revokedAt: true,
      scope: true,
    },
  });
  if (!shareLink) return null;
  if (shareLink.scope !== "verification_report") return null;
  if (shareLink.revokedAt) return null;
  if (shareLink.expiresAt.getTime() <= Date.now()) return null;
  const shop = await prisma.shop.findUnique({
    where: { id: shareLink.shopId },
    select: { plan: true },
  });
  const currentPlan = normalizePlanId((shop?.plan || "free") as string) as PlanId;
  if (!planSupportsReportExport(currentPlan)) {
    return null;
  }
  await (prisma as any).reportShareLink.update({
    where: { id: shareLink.id },
    data: {
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });
  const reportData = await generateVerificationReportData(shareLink.shopId, shareLink.runId);
  return toPublicReportData(reportData, {
    tokenPrefix: shareLink.tokenPrefix,
    expiresAt: shareLink.expiresAt,
  });
}
