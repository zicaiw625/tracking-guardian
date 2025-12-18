import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runAllShopsReconciliation } from "../services/reconciliation.server";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";

// This endpoint is called by a cron job service (e.g., Vercel Cron, Railway Cron)
// to run daily reconciliation for all shops

/**
 * Validates the cron request authorization
 * Returns an error response if unauthorized, null if authorized
 */
function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  // SECURITY FIX: Always require CRON_SECRET to be set
  if (!cronSecret) {
    console.error("CRON_SECRET environment variable is not set");
    return json(
      { error: "Cron endpoint not configured. Set CRON_SECRET environment variable." },
      { status: 503 }
    ) as unknown as Response;
  }

  // Check for Vercel Cron header (Vercel sends this header for cron jobs)
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  if (vercelCronHeader === "true") {
    // Vercel Cron requests are trusted
    return null;
  }

  // Check Bearer token authorization
  if (authHeader !== `Bearer ${cronSecret}`) {
    console.warn(`Unauthorized cron access attempt from ${request.headers.get("x-forwarded-for") || "unknown"}`);
    return json({ error: "Unauthorized" }, { status: 401 }) as unknown as Response;
  }

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn("Cron endpoint rate limited");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const results = await runAllShopsReconciliation();

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return json({
      success: true,
      message: `Reconciliation completed: ${successful} successful, ${failed} failed`,
      results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

// Also support GET for simple cron services (like Vercel Cron)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Rate limiting check
  const rateLimit = checkRateLimit(request, "cron");
  if (rateLimit.isLimited) {
    console.warn("Cron endpoint rate limited (GET)");
    return createRateLimitResponse(rateLimit.retryAfter);
  }

  const authError = validateCronAuth(request);
  if (authError) {
    return authError;
  }

  try {
    const results = await runAllShopsReconciliation();

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return json({
      success: true,
      message: `Reconciliation completed: ${successful} successful, ${failed} failed`,
      results,
    });
  } catch (error) {
    console.error("Cron job error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
};

