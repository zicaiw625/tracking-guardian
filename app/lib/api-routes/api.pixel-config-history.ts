import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../../shopify.server";
import {
  getConfigComparison,
  getConfigVersionHistory,
} from "../../services/pixel-rollback.server";
import { logger } from "../../utils/logger.server";
import prisma from "../../db.server";
import { jsonApi } from "../../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const url = new URL(request.url);
  const platform = url.searchParams.get("platform");
  const type = url.searchParams.get("type");
  if (!platform) {
    return jsonApi({ error: "Missing platform parameter" }, { status: 400 });
  }
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonApi({ error: "Shop not found" }, { status: 404 });
  }
  try {
    if (type === "comparison") {
      const comparison = await getConfigComparison(shop.id, platform);
      return jsonApi({ comparison });
    } else if (type === "history") {
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 10;
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        return jsonApi({ error: "Invalid limit parameter" }, { status: 400 });
      }
      const limit = Math.min(parsedLimit, 100);
      const history = await getConfigVersionHistory(shop.id, platform, limit);
      return jsonApi({ history });
    } else {
      return jsonApi({ error: "Invalid type parameter" }, { status: 400 });
    }
  } catch (error) {
    logger.error("Failed to fetch config history", { error });
    return jsonApi(
      { error: "Failed to fetch configuration history" },
      { status: 500 }
    );
  }
};
