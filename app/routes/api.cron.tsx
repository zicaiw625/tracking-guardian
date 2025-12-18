import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runAllShopsReconciliation } from "../services/reconciliation.server";
import { checkRateLimit, createRateLimitResponse } from "../utils/rate-limiter";

// This endpoint is called by a cron job service (e.g., Vercel Cron, Railway Cron)
// to run daily reconciliation for all shops

/**
 * Validates the cron request authorization
 * Returns an error response if unauthorized, null if authorized
 * 
 * SECURITY NOTE: We require CRON_SECRET for all requests.
 * The x-vercel-cron header alone is NOT sufficient as it can be spoofed.
 * Vercel Cron jobs should be configured to include the Authorization header.
 */
function validateCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  // Always require CRON_SECRET to be set in production
  if (!cronSecret) {
    if (isProduction) {
      console.error("CRITICAL: CRON_SECRET environment variable is not set in production");
    return json(
        { error: "Cron endpoint not configured" },
      { status: 503 }
    ) as unknown as Response;
  }
    // In development, allow without auth but warn
    console.warn("⚠️ CRON_SECRET not set. Allowing unauthenticated access in development only.");
    return null;
  }

  // Validate secret length
  if (cronSecret.length < 32) {
    console.warn("⚠️ CRON_SECRET is shorter than recommended 32 characters");
  }

  // Always verify the Authorization header - x-vercel-cron header can be spoofed
  // For Vercel Cron, configure the cron job to include:
  // headers: { "Authorization": "Bearer YOUR_CRON_SECRET" }
  if (authHeader !== `Bearer ${cronSecret}`) {
    const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     request.headers.get("x-real-ip") || 
                     "unknown";
    const vercelCronHeader = request.headers.get("x-vercel-cron");
    
    // Log the attempt with relevant details for security monitoring
    console.warn(
      `Unauthorized cron access attempt: IP=${clientIP}, ` +
      `hasVercelHeader=${!!vercelCronHeader}, ` +
      `hasAuthHeader=${!!authHeader}`
    );
    
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

