import { timingSafeEqual , createHmac, createHash } from "crypto";
import { logger } from "../utils/logger.server";
import { readTextWithLimit } from "../utils/body-reader";

const REPLAY_WINDOW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

export function validateCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const cronSecretPrevious = process.env.CRON_SECRET_PREVIOUS || "";

  if (!cronSecret) {
    const isDevelopment = process.env.NODE_ENV === "development";
    const isLocalhost = (() => {
      const host = process.env.HOST || process.env.APP_URL || "";
      if (!host) return true;
      try {
        const url = new URL(host);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
      } catch {
        return true;
      }
    })();
    
    if (isDevelopment && isLocalhost && process.env.LOCAL_DEV === "true") {
      logger.warn("CRON_SECRET not configured (development + localhost + LOCAL_DEV=true) - allowing unauthenticated access");
      return null;
    }
    logger.error("CRON_SECRET not configured - rejecting request");
    return new Response("Service unavailable: CRON_SECRET not configured", { status: 503 });
  }

  if (cronSecret.length < MIN_SECRET_LENGTH) {
    logger.warn(`CRON_SECRET is shorter than recommended minimum length (${MIN_SECRET_LENGTH} chars)`);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized: Missing or invalid Authorization header", { status: 401 });
  }

  const expectedHeader = `Bearer ${cronSecret}`;
  const expectedHeaderPrevious = cronSecretPrevious ? `Bearer ${cronSecretPrevious}` : null;

  let isValid = false;
  let isRotation = false;

  if (authHeader.length === expectedHeader.length) {
    try {
      const authBuffer = Buffer.from(authHeader);
      const expectedBuffer = Buffer.from(expectedHeader);
      isValid = timingSafeEqual(authBuffer, expectedBuffer);
    } catch {
      isValid = false;
    }
  }

  if (!isValid && expectedHeaderPrevious && authHeader.length === expectedHeaderPrevious.length) {
    try {
      const authBuffer = Buffer.from(authHeader);
      const expectedBuffer = Buffer.from(expectedHeaderPrevious);
      isValid = timingSafeEqual(authBuffer, expectedBuffer);
      isRotation = isValid;
    } catch {
      isValid = false;
    }
  }

  if (!isValid) {
    return new Response("Unauthorized: Invalid token", { status: 401 });
  }

  if (isRotation) {
    logger.info("Cron request authenticated using CRON_SECRET_PREVIOUS (rotation in progress)");
  }

  return null;
}

export interface ReplayProtectionResult {
  valid: boolean;
  error?: string;
}

export async function verifyReplayProtection(
  request: Request,
  secretOrSecrets: string | string[]
): Promise<ReplayProtectionResult> {
  const strictReplay = process.env.CRON_STRICT_REPLAY === "true";
  const isProduction = process.env.NODE_ENV === "production";
  const enforceReplayProtection = strictReplay || isProduction;

  if (!enforceReplayProtection) {
    return { valid: true };
  }

  const timestampHeader = request.headers.get("X-Cron-Timestamp");
  const signatureHeader = request.headers.get("X-Cron-Signature");

  if (!timestampHeader) {
    return { valid: false, error: "Missing timestamp header" };
  }

  if (!signatureHeader) {
    return { valid: false, error: "Missing signature header" };
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) {
    return { valid: false, error: "Invalid timestamp format" };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - timestamp);

  if (age > REPLAY_WINDOW_SECONDS) {
    return {
      valid: false,
      error: `Timestamp out of range (age: ${age}s, max: ${REPLAY_WINDOW_SECONDS}s)`,
    };
  }

  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  let bodyHash = "";
  try {
    const bodyText = await readTextWithLimit(request.clone(), 64 * 1024);
    if (bodyText) {
      bodyHash = createHash("sha256").update(bodyText).digest("hex");
    }
  } catch {
    bodyHash = "";
  }

  const signatureContent = `${method}:${pathname}:${timestampHeader}:${bodyHash}`;
  const secrets = Array.isArray(secretOrSecrets) ? secretOrSecrets : [secretOrSecrets];
  
  let validSignatureFound = false;

  for (const secret of secrets) {
    if (!secret) continue;
    const expectedSignature = createHmac("sha256", secret).update(signatureContent).digest("hex");

    if (signatureHeader.length !== expectedSignature.length) {
      continue;
    }

    try {
      const signatureBuffer = Buffer.from(signatureHeader, "hex");
      const expectedBuffer = Buffer.from(expectedSignature, "hex");
      const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

      if (isValid) {
        validSignatureFound = true;
        break;
      }
    } catch {
      // Continue to next secret
    }
  }

  if (!validSignatureFound) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}

export function isSecretRotationActive(): boolean {
  return !!(process.env.CRON_SECRET && process.env.CRON_SECRET_PREVIOUS);
}

export function getRotationStatus(): {
  rotationActive: boolean;
  hasPrimarySecret: boolean;
  hasPreviousSecret: boolean;
  primarySecretLength: number;
  previousSecretLength: number;
} {
  const primary = process.env.CRON_SECRET || "";
  const previous = process.env.CRON_SECRET_PREVIOUS || "";

  return {
    rotationActive: !!(primary && previous),
    hasPrimarySecret: !!primary,
    hasPreviousSecret: !!previous,
    primarySecretLength: primary.length,
    previousSecretLength: previous.length,
  };
}
