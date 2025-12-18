import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { runAllShopsReconciliation } from "../services/reconciliation.server";

// This endpoint is called by a cron job service (e.g., Vercel Cron, Railway Cron)
// to run daily reconciliation for all shops

export const action = async ({ request }: ActionFunctionArgs) => {
  // Verify the request is from an authorized source
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
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

// Also support GET for simple cron services
export const loader = async ({ request }: ActionFunctionArgs) => {
  return action({ request } as ActionFunctionArgs);
};

