/**
 * Cron Authentication Module
 *
 * Handles cron endpoint authentication including:
 * - Bearer token validation with rotation support
 * - Replay protection with timestamp and signature verification
 * 
 * P1-5: Enhanced with secret rotation support:
 * - CRON_SECRET: Primary/current secret
 * - CRON_SECRET_PREVIOUS: Previous secret (valid during rotation window)
 */

import { createHmac, timingSafeEqual } from "crypto";
import { logger } from "../utils/logger.server";
import {
  unauthorizedResponse,
  serviceUnavailableResponse,
} from "../utils/responses";
import type { ReplayProtectionResult } from "./types";

// =============================================================================
// Constants
// =============================================================================

/** Time window for replay protection (5 minutes) */
const REPLAY_PROTECTION_WINDOW_MS = 5 * 60 * 1000;

/** Minimum recommended secret length */
const MIN_SECRET_LENGTH = 32;

// =============================================================================
// P1-5: Secret Rotation Support
// =============================================================================

/**
 * P1-5: Get all valid cron secrets for rotation support.
 * 
 * Returns an array of secrets to try in order:
 * 1. CRON_SECRET (primary)
 * 2. CRON_SECRET_PREVIOUS (previous, for rotation window)
 * 
 * This allows for zero-downtime secret rotation:
 * 1. Set CRON_SECRET_PREVIOUS to current secret
 * 2. Set CRON_SECRET to new secret
 * 3. Deploy
 * 4. After all clients are updated, remove CRON_SECRET_PREVIOUS
 */
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

/**
 * P1-5: Validate a secret against a bearer token.
 * Returns true if they match using timing-safe comparison.
 */
function validateBearerToken(authHeader: string | null, secret: string): boolean {
  if (!authHeader) return false;
  
  const expectedHeader = `Bearer ${secret}`;
  
  // Use timing-safe comparison
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

/**
 * P1-5: Check secrets and return which one matched (if any).
 */
function checkSecrets(
  authHeader: string | null,
  secrets: string[]
): { matched: boolean; usedPrevious: boolean } {
  if (secrets.length === 0) {
    return { matched: false, usedPrevious: false };
  }

  // Try primary secret first
  if (validateBearerToken(authHeader, secrets[0])) {
    return { matched: true, usedPrevious: false };
  }

  // Try previous secret if available
  if (secrets.length > 1 && validateBearerToken(authHeader, secrets[1])) {
    return { matched: true, usedPrevious: true };
  }

  return { matched: false, usedPrevious: false };
}

// =============================================================================
// Replay Protection
// =============================================================================

/**
 * Verify replay protection using timestamp and HMAC signature.
 * 
 * P1-5: Updated to try signature verification with all valid secrets.
 * 
 * @param request - Incoming HTTP request
 * @param secrets - Array of secrets to try for signature verification
 * @returns Validation result with error message if invalid
 */
function verifyReplayProtectionWithSecrets(
  request: Request,
  secrets: string[]
): ReplayProtectionResult {
  const timestamp = request.headers.get("X-Cron-Timestamp");
  const signature = request.headers.get("X-Cron-Signature");
  const isProduction = process.env.NODE_ENV === "production";
  const strictReplayProtection = process.env.CRON_STRICT_REPLAY !== "false";

  // No timestamp provided
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

  // Validate timestamp format
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    return { valid: false, error: "Invalid timestamp format" };
  }

  // Check timestamp is within acceptable window
  const now = Math.floor(Date.now() / 1000);
  const timeDiff = Math.abs(now - requestTime);
  if (timeDiff > REPLAY_PROTECTION_WINDOW_MS / 1000) {
    logger.warn("Cron request timestamp out of range", { timeDiff });
    return { valid: false, error: "Request timestamp out of range (possible replay attack)" };
  }

  // Require signature in production with strict replay protection
  if (isProduction && strictReplayProtection && !signature) {
    logger.warn("Cron request has timestamp but missing signature");
    return { valid: false, error: "Missing signature (required when timestamp is provided)" };
  }

  // Verify signature if provided
  if (signature) {
    // P1-5: Try each secret for signature verification
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

    // Log if previous secret was used for signature (for monitoring rotation)
    if (usedPreviousForSignature) {
      logger.info("[Cron] Signature verified using CRON_SECRET_PREVIOUS - consider updating clients");
    }
  }

  return { valid: true };
}

/**
 * Verify replay protection using timestamp and HMAC signature.
 * 
 * @param request - Incoming HTTP request
 * @param cronSecret - The cron secret for signature verification
 * @returns Validation result with error message if invalid
 */
export function verifyReplayProtection(
  request: Request,
  cronSecret: string
): ReplayProtectionResult {
  return verifyReplayProtectionWithSecrets(request, [cronSecret]);
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Validate cron endpoint authentication.
 * 
 * P1-5: Enhanced with secret rotation support:
 * - Supports CRON_SECRET and CRON_SECRET_PREVIOUS
 * - Logs when previous secret is used (for monitoring)
 * 
 * Checks:
 * 1. CRON_SECRET is configured (required in production)
 * 2. Authorization header matches Bearer token
 * 3. Replay protection passes
 * 
 * @param request - Incoming HTTP request
 * @returns null if authenticated, Response if authentication failed
 */
export function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const isProduction = process.env.NODE_ENV === "production";

  // P1-5: Get all valid secrets
  const { secrets, primary } = getCronSecrets();

  // Check CRON_SECRET is configured
  if (!primary) {
    if (isProduction) {
      logger.error("CRITICAL: CRON_SECRET environment variable is not set in production");
      return serviceUnavailableResponse("Cron endpoint not configured");
    }
    logger.warn("CRON_SECRET not set. Allowing unauthenticated access in development only.");
    return null;
  }

  // Warn about weak secret
  if (primary.length < MIN_SECRET_LENGTH) {
    logger.warn(`CRON_SECRET is shorter than recommended ${MIN_SECRET_LENGTH} characters`);
  }

  // P1-5: Check all secrets for bearer token
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

  // P1-5: Log if previous secret was used
  if (usedPrevious) {
    logger.info(
      "[Cron] Authentication succeeded using CRON_SECRET_PREVIOUS - " +
      "consider updating cron service to use new secret"
    );
  }

  // Verify replay protection with all valid secrets
  const replayCheck = verifyReplayProtectionWithSecrets(request, secrets);
  if (!replayCheck.valid) {
    logger.warn(`Cron replay protection failed: ${replayCheck.error}`);
    return unauthorizedResponse(replayCheck.error ?? "Replay protection failed");
  }

  return null;
}

// =============================================================================
// Utility Exports
// =============================================================================

/**
 * P1-5: Check if secret rotation is currently active.
 * 
 * This can be used by monitoring/health checks to track rotation status.
 */
export function isSecretRotationActive(): boolean {
  const previous = process.env.CRON_SECRET_PREVIOUS;
  const current = process.env.CRON_SECRET;
  return Boolean(previous && current && previous !== current);
}

/**
 * P1-5: Get rotation status for monitoring.
 */
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
