import type { ActionFunctionArgs } from "@remix-run/node";
import { createHash, randomBytes } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { authenticate } from "../shopify.server";
import { readJsonWithSizeLimit } from "../utils/body-size-guard";
import { jsonApi } from "../utils/security-headers";

const SHARE_TOKEN_EXPIRY_DAYS = 7;

interface ShareRequest {
  reportType: "scan" | "verification";
  reportId: string;
}

function generateShareToken(reportId: string, reportType: string): string {
  const timestamp = Date.now();
  const random = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(`${reportId}-${reportType}-${timestamp}-${random}`)
    .digest("hex")
    .substring(0, 32);
  return hash;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonApi({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return jsonApi({ error: "Shop not found" }, { status: 404 });
    }
    let body: ShareRequest | null;
    try {
      body = await readJsonWithSizeLimit<ShareRequest>(request);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      return jsonApi({ error: "Failed to parse request body" }, { status: 400 });
    }
    if (!body || !body.reportType || !body.reportId) {
      return jsonApi({ error: "Missing required fields: reportType, reportId" }, { status: 400 });
    }
    const { reportType, reportId } = body;
    if (reportType === "scan") {
      const scanReport = await prisma.scanReport.findFirst({
        where: {
          id: reportId,
          shopId: shop.id,
        },
        select: { id: true },
      });
      if (!scanReport) {
        return jsonApi({ error: "Scan report not found" }, { status: 404 });
      }
      const shareToken = generateShareToken(reportId, reportType);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + SHARE_TOKEN_EXPIRY_DAYS);
      const baseUrl = process.env.SHOPIFY_APP_URL || process.env.PUBLIC_APP_URL || "https://app.tracking-guardian.com";
      const shareUrl = `${baseUrl}/share/scan/${reportId}?token=${shareToken}`;
      const tokenHash = createHash("sha256")
        .update(`${reportId}-${shop.id}-${shareToken}`)
        .digest("hex");
      await prisma.scanReport.update({
        where: { id: reportId },
        data: {
          shareTokenHash: tokenHash,
          shareTokenExpiresAt: expiresAt,
        },
      });
      logger.info("Share link generated for scan report", {
        shopId: shop.id,
        reportId,
        expiresAt: expiresAt.toISOString(),
      });
      return jsonApi({
        success: true,
        shareUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }
    if (reportType === "verification") {
      const verificationRun = await prisma.verificationRun.findFirst({
        where: {
          id: reportId,
          shopId: shop.id,
        },
        select: { id: true, publicId: true },
      });
      if (!verificationRun) {
        return jsonApi({ error: "Verification run not found" }, { status: 404 });
      }
      let publicId = verificationRun.publicId;
      if (!publicId) {
        publicId = createHash("sha256")
          .update(`${reportId}-${shop.id}-${Date.now()}`)
          .digest("hex")
          .substring(0, 16);
        await prisma.verificationRun.update({
          where: { id: reportId },
          data: { publicId },
        });
      }
      const shareToken = generateShareToken(reportId, reportType);
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + SHARE_TOKEN_EXPIRY_DAYS);
      const baseUrl = process.env.SHOPIFY_APP_URL || process.env.PUBLIC_APP_URL || "https://app.tracking-guardian.com";
      const shareUrl = `${baseUrl}/share/verification/${publicId}?token=${shareToken}`;
      const tokenHash = createHash("sha256")
        .update(`${reportId}-${shop.id}-${shareToken}`)
        .digest("hex");
      await prisma.verificationRun.update({
        where: { id: reportId },
        data: {
          publicTokenHash: tokenHash,
          shareTokenExpiresAt: expiresAt,
        },
      });
      logger.info("Share link generated for verification report", {
        shopId: shop.id,
        reportId,
        publicId,
        expiresAt: expiresAt.toISOString(),
      });
      return jsonApi({
        success: true,
        shareUrl,
        expiresAt: expiresAt.toISOString(),
      });
    }
    return jsonApi({ error: "Invalid report type" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to generate share link", { error });
    return jsonApi(
      { error: error instanceof Error ? error.message : "Failed to generate share link" },
      { status: 500 }
    );
  }
};
