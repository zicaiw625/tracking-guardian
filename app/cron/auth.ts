import { timingSafeEqual , createHmac, createHash } from "crypto";
import { logger } from "../utils/logger.server";
import { readTextWithLimit } from "../utils/body-reader";
import { getRedisClient } from "../utils/redis-client.server";

const REPLAY_WINDOW_SECONDS = 300;
const MIN_SECRET_LENGTH = 32;
const LOCALHOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalHostname(hostname: string): boolean {
  return LOCALHOSTS.has(hostname.toLowerCase());
}

function parseHostLikeValue(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    return parsed.hostname;
  } catch {
    return null;
  }
}

function parseStrictUnixTimestamp(raw: string): number | null {
  if (!/^\d{1,13}$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function validateCronAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  const cronSecretPrevious = process.env.CRON_SECRET_PREVIOUS || "";

  if (!cronSecret) {
    const isDevelopment = process.env.NODE_ENV === "development";
    const requestHostname = (() => {
      try {
        return new URL(request.url).hostname;
      } catch {
        return "";
      }
    })();
    const configuredHost = process.env.HOST || process.env.APP_URL || "";
    const configuredHostname = parseHostLikeValue(configuredHost);
    const requestIsLocal = requestHostname ? isLocalHostname(requestHostname) : false;
    const configuredIsLocal = configuredHostname ? isLocalHostname(configuredHostname) : false;
    const allowLocalBypass = isDevelopment
      && process.env.LOCAL_DEV === "true"
      && requestIsLocal
      && (!configuredHost || configuredIsLocal);

    if (allowLocalBypass) {
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
  const nonceHeader = request.headers.get("X-Cron-Nonce");

  if (!timestampHeader) {
    return { valid: false, error: "Missing timestamp header" };
  }

  if (!signatureHeader) {
    return { valid: false, error: "Missing signature header" };
  }
  if (!nonceHeader) {
    return { valid: false, error: "Missing nonce header" };
  }
  if (nonceHeader.length < 8 || nonceHeader.length > 128) {
    return { valid: false, error: "Invalid nonce format" };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(nonceHeader)) {
    return { valid: false, error: "Invalid nonce format" };
  }

  const timestamp = parseStrictUnixTimestamp(timestampHeader);
  if (timestamp === null) {
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
  } catch (error) {
    logger.warn("Cron replay protection failed to read request body", {
      error: error instanceof Error ? error.message : String(error),
      method,
      pathname,
    });
    return { valid: false, error: "Invalid request body for signature verification" };
  }

  const signatureContent = `${method}:${pathname}:${timestampHeader}:${nonceHeader}:${bodyHash}`;
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

  try {
    const redis = await getRedisClient();
    const nonceKey = `cron:nonce:${timestampHeader}:${nonceHeader}`;
    const acquired = await redis.setNX(
      nonceKey,
      "1",
      REPLAY_WINDOW_SECONDS * 1000
    );
    if (!acquired) {
      return { valid: false, error: "Replay detected (nonce already used)" };
    }
  } catch (error) {
    if (isProduction) {
      logger.warn("Cron replay nonce check failed in production", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { valid: false, error: "Replay protection storage unavailable" };
    }
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
