import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { logger } from "../utils/logger";
const TRACKING_API_ENABLED = process.env.ENABLE_TRACKING_API === "true";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    if (!TRACKING_API_ENABLED) {
        logger.info("[P0-06] Tracking API request rejected - endpoint disabled for security review");
        return json({
            error: "This endpoint is currently disabled for security review",
            code: "ENDPOINT_DISABLED",
            message: "Order tracking information is available directly through Shopify's order status page."
        }, { status: 503 });
    }
    return json({ error: "Not implemented" }, { status: 501 });
};
export const action = async () => {
    return json({ error: "Method not allowed" }, { status: 405 });
};
