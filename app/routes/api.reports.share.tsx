import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHash, randomBytes } from "crypto";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { authenticate } from "../shopify.server";
import { API_CONFIG } from "../utils/config";

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
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }
    const contentLength = request.headers.get("Content-Length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > API_CONFIG.MAX_BODY_SIZE) {
        logger.warn(`Share request body too large: ${size} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
        return json(
          { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
          { status: 413 }
        );
      }
    }
    const bodyText = await request.text();
    if (bodyText.length > API_CONFIG.MAX_BODY_SIZE) {
      logger.warn(`Share request body too large: ${bodyText.length} bytes (max ${API_CONFIG.MAX_BODY_SIZE})`);
      return json(
        { error: "Payload too large", maxSize: API_CONFIG.MAX_BODY_SIZE },
        { status: 413 }
      );
    }
    const body = JSON.parse(bodyText) as ShareRequest | null;
    if (!body || !body.reportType || !body.reportId) {
      return json({ error: "Missing required fields: reportType, reportId" }, { status: 400 });
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
        return json({ error: "Scan report not found" }, { status: 404 });
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
      const headers = new Headers();
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      headers.set("Referrer-Policy", "no-referrer");
      return json({
        success: true,
        shareUrl,
        expiresAt: expiresAt.toISOString(),
        tokenHash, 
      }, { headers });
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
        return json({ error: "Verification run not found" }, { status: 404 });
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
      const headers = new Headers();
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      headers.set("Referrer-Policy", "no-referrer");
      return json({
        success: true,
        shareUrl,
        expiresAt: expiresAt.toISOString(),
      }, { headers });
    }
    return json({ error: "Invalid report type" }, { status: 400 });
  } catch (error) {
    logger.error("Failed to generate share link", { error });
    return json(
      { error: error instanceof Error ? error.message : "Failed to generate share link" },
      { status: 500 }
    );
  }
};
