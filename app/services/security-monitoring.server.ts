import prisma from "../db.server";

export interface HMACSecurityStats {
  lastRotationAt: Date | null;
  rotationCount: number;
  graceWindowActive: boolean;
  graceWindowExpiry: Date | null;
  suspiciousActivityCount: number;
  lastSuspiciousActivity: Date | null;
  nullOriginRequestCount: number;
  invalidSignatureCount: number;
  lastInvalidSignature: Date | null;
}

export async function getHMACSecurityStats(shopId: string, hours: number = 24): Promise<HMACSecurityStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      previousSecretExpiry: true,
      updatedAt: true,
      ingestionSecret: true,
      previousIngestionSecret: true,
    },
  });
  const hasActiveGraceWindow = shop?.previousSecretExpiry && new Date() < shop.previousSecretExpiry;
  const rotationCount = shop?.previousIngestionSecret ? 1 : 0;
  const receipts = await prisma.pixelEventReceipt.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      payloadJson: true,
      createdAt: true,
    },
  });
  let nullOriginCount = 0;
  let invalidSignatureCount = 0;
  let lastInvalidSignature: Date | null = null;
  for (const receipt of receipts) {
    const payload = receipt.payloadJson as Record<string, unknown> | null;
    if (payload) {
      const origin = payload.origin as string | undefined;
      if (origin === "null" || origin === null) {
        nullOriginCount++;
      }
      const errorCode = payload.errorCode as string | undefined;
      if (errorCode === "invalid_signature" || errorCode === "missing_signature") {
        invalidSignatureCount++;
        if (!lastInvalidSignature || receipt.createdAt > lastInvalidSignature) {
          lastInvalidSignature = receipt.createdAt;
        }
      }
    }
  }
  return {
    lastRotationAt: shop?.updatedAt || null,
    rotationCount,
    graceWindowActive: !!hasActiveGraceWindow,
    graceWindowExpiry: shop?.previousSecretExpiry || null,
    suspiciousActivityCount: invalidSignatureCount + (nullOriginCount > 10 ? nullOriginCount : 0),
    lastSuspiciousActivity: lastInvalidSignature,
    nullOriginRequestCount: nullOriginCount,
    invalidSignatureCount,
    lastInvalidSignature,
  };
}
