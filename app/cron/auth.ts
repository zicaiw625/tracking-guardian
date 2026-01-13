import { timingSafeEqual } from "crypto";
import { createHmac } from "crypto";
import { logger } from "../utils/logger.server";

const REPLAY_WINDOW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;

export function validateCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const cronSecretPrevious = process.env.CRON_SECRET_PREVIOUS || "";

  if (!cronSecret && process.env.NODE_ENV !== "production") {
    logger.warn("CRON_SECRET not configured - allowing unauthenticated access in development");
    return null;
  }

  if (!cronSecret) {
    logger.error("CRON_SECRET not configured in production - rejecting request");
    return new Response("Service unavailable: CRON_SECRET not configured", { status: 503 });
  }

  if (cronSecret.length < MIN_SECRET_LENGTH) {
    logger.warn(`CRON_SECRET is shorter than recommended minimum length (${MIN_SECRET_LENGTH} chars)`);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized: Missing or invalid Authorization header", { status: 401 });
  }

  const token = authHeader.substring(7);
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

export function verifyReplayProtection(
  request: Request,
  secret: string
): ReplayProtectionResult {
  const strictReplay = process.env.CRON_STRICT_REPLAY === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (!strictReplay && !isProduction) {
    return { valid: true };
  }

  const timestampHeader = request.headers.get("X-Cron-Timestamp");
  const signatureHeader = request.headers.get("X-Cron-Signature");

  if (!timestampHeader) {
    if (isProduction && strictReplay) {
      return { valid: false, error: "Missing timestamp header" };
    }
    return { valid: true };
  }

  if (!signatureHeader) {
    if (isProduction && strictReplay) {
      return { valid: false, error: "Missing signature header" };
    }
    return { valid: true };
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

  const expectedSignature = createHmac("sha256", secret).update(timestampHeader).digest("hex");

  if (signatureHeader.length !== expectedSignature.length) {
    return { valid: false, error: "Invalid signature length" };
  }

  try {
    const signatureBuffer = Buffer.from(signatureHeader, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

    if (!isValid) {
      return { valid: false, error: "Invalid signature" };
    }
  } catch {
    return { valid: false, error: "Invalid signature format" };
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
