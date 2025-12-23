/**
 * Cron Authentication Module
 *
 * Handles cron endpoint authentication including:
 * - Bearer token validation
 * - Replay protection with timestamp and signature verification
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

// =============================================================================
// Replay Protection
// =============================================================================

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
    const expectedSignature = createHmac("sha256", cronSecret)
      .update(timestamp)
      .digest("hex");

    try {
      const signatureBuffer = Buffer.from(signature, "hex");
      const expectedBuffer = Buffer.from(expectedSignature, "hex");

      if (signatureBuffer.length !== expectedBuffer.length) {
        return { valid: false, error: "Invalid signature" };
      }

      if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return { valid: false, error: "Invalid signature" };
      }
    } catch {
      return { valid: false, error: "Invalid signature format" };
    }
  }

  return { valid: true };
}

// =============================================================================
// Authentication
// =============================================================================

/**
 * Validate cron endpoint authentication.
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
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  // Check CRON_SECRET is configured
  if (!cronSecret) {
    if (isProduction) {
      logger.error("CRITICAL: CRON_SECRET environment variable is not set in production");
      return serviceUnavailableResponse("Cron endpoint not configured");
    }
    logger.warn("CRON_SECRET not set. Allowing unauthenticated access in development only.");
    return null;
  }

  // Warn about weak secret
  if (cronSecret.length < 32) {
    logger.warn("CRON_SECRET is shorter than recommended 32 characters");
  }

  // Verify Bearer token
  if (authHeader !== `Bearer ${cronSecret}`) {
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

  // Verify replay protection
  const replayCheck = verifyReplayProtection(request, cronSecret);
  if (!replayCheck.valid) {
    logger.warn(`Cron replay protection failed: ${replayCheck.error}`);
    return unauthorizedResponse(replayCheck.error ?? "Replay protection failed");
  }

  return null;
}

