

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../utils/logger.server";
import {
  unauthorizedResponse,
  serviceUnavailableResponse,
} from "../utils/responses";
import type { ReplayProtectionResult } from "./types";

const REPLAY_PROTECTION_WINDOW_MS = 5 * 60 * 1000;

const MIN_SECRET_LENGTH = 32;

function getCronSecrets(): { secrets: string[]; primary: string | null } {
  const primary = process.env.CRON_SECRET || null;
  const previous = process.env.CRON_SECRET_PREVIOUS || null;

  const secrets: string[] = [];

  if (primary) {
    secrets.push(primary);
  }

  if (previous && previous !== primary) {
    secrets.push(previous);
  }

  return { secrets, primary };
}

function validateBearerToken(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false;

  const expectedHeader = `Bearer ${secret}`;

  if (authHeader.length !== expectedHeader.length) {
    return false;
  }

  try {
    const authBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(expectedHeader);
    return timingSafeEqual(authBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function checkSecrets(
  authHeader: string | null,
  secrets: string[]
): { matched: boolean; usedPrevious: boolean } {
  if (secrets.length === 0) {
    return { matched: false, usedPrevious: false };
  }

  if (validateBearerToken(authHeader, secrets[0])) {
    return { matched: true, usedPrevious: false };
  }

  if (secrets.length > 1 && validateBearerToken(authHeader, secrets[1])) {
    return { matched: true, usedPrevious: true };
  }

  return { matched: false, usedPrevious: false };
}

function verifyReplayProtectionWithSecrets(
  request: Request,
  secrets: string[]
): ReplayProtectionResult {
  const timestamp = request.headers.get("X-Cron-Timestamp");
  const signature = request.headers.get("X-Cron-Signature");
  const isProduction = process.env.NODE_ENV === "production";
  const strictReplayProtection = process.env.CRON_STRICT_REPLAY !== "false";

  if (!timestamp) {
    if (isProduction && strictReplayProtection) {
      logger.warn("Cron request missing timestamp header in production");
      return { valid: false, error: "Missing timestamp header (required in production)" };
    }
    if (isProduction) {
      logger.warn("Cron request accepted without timestamp (CRON_STRICT_REPLAY=false)");
    }
    return { valid: true };
  }

  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, error: "Invalid timestamp format" };
  }

  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - requestTime);
  if (timeDiff > REPLAY_PROTECTION_WINDOW_MS / 1000) {
    logger.warn("Cron request timestamp out of range", { timeDiff });
    return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
  }

  if (isProduction && strictReplayProtection && !signature) {
    logger.warn("Cron request has timestamp but missing signature");
    return { valid: false, error: "Missing signature (required when timestamp is provided)" };
  }

  if (signature) {

    let signatureValid = false;
    let usedPreviousForSignature = false;

    for (let i = 0; i < secrets.length; i++) {
      const secret = secrets[i];
      const expectedSignature = createHmac("sha256", secret)
        .update(timestamp)
        .digest("hex");

      try {
        const signatureBuffer = Buffer.from(signature, "hex");
        const expectedBuffer = Buffer.from(expectedSignature, "hex");

        if (signatureBuffer.length !== expectedBuffer.length) {
          continue;
        }

        if (timingSafeEqual(signatureBuffer, expectedBuffer)) {
          signatureValid = true;
          usedPreviousForSignature = i > 0;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!signatureValid) {
      return { valid: false, error: "Invalid signature" };
    }

    if (usedPreviousForSignature) {
      logger.info("[Cron] Signature verified using CRON_SECRET_PREVIOUS - consider updating clients");
    }
  }

  return { valid: true };
}

export function verifyReplayProtection(
  request: Request,
  cronSecret: string
): ReplayProtectionResult {
  return verifyReplayProtectionWithSecrets(request, [cronSecret]);
}

export function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const isProduction = process.env.NODE_ENV === "production";

  const { secrets, primary } = getCronSecrets();

  if (!primary) {
    if (isProduction) {
      logger.error("CRITICAL: CRON_SECRET environment variable is not set in production");
      return serviceUnavailableResponse("Cron endpoint not configured");
    }
    logger.warn("CRON_SECRET not set. Allowing unauthenticated access in development only.");
    return null;
  }

  if (primary.length < MIN_SECRET_LENGTH) {
    logger.warn(`CRON_SECRET is shorter than recommended ${MIN_SECRET_LENGTH} characters`);
  }

  const { matched, usedPrevious } = checkSecrets(authHeader, secrets);

  if (!matched) {
    const clientIP =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const vercelCronHeader = request.headers.get("x-vercel-cron");

    logger.warn("Unauthorized cron access attempt", {
      clientIP,
      hasVercelHeader: !!vercelCronHeader,
      hasAuthHeader: !!authHeader,
    });

    return unauthorizedResponse("Unauthorized");
  }

  if (usedPrevious) {
    logger.info(
      "[Cron] Authentication succeeded using CRON_SECRET_PREVIOUS - " +
      "consider updating cron service to use new secret"
    );
  }

  const replayCheck = verifyReplayProtectionWithSecrets(request, secrets);
  if (!replayCheck.valid) {
    logger.warn(`Cron replay protection failed: ${replayCheck.error}`);
    return unauthorizedResponse(replayCheck.error ?? "Replay protection failed");
  }

  return null;
}

export function isSecretRotationActive(): boolean {
  const previous = process.env.CRON_SECRET_PREVIOUS;
  const current = process.env.CRON_SECRET;
  return Boolean(previous && current && previous !== current);
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
    rotationActive: Boolean(previous && primary && previous !== primary),
    hasPrimarySecret: Boolean(primary),
    hasPreviousSecret: Boolean(previous),
    primarySecretLength: primary.length,
    previousSecretLength: previous.length,
  };
}
