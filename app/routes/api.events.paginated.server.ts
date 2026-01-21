import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { paginateConversionLogs } from "../services/db/query-optimizer.server";
import { jsonApi } from "../utils/security-headers";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!shop) {
    return jsonApi({ error: "Shop not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const take = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
  const orderBy = (url.searchParams.get("orderBy") || "desc") as "asc" | "desc";
  const hours = parseInt(url.searchParams.get("hours") || "24", 10);
  const since = new Date();
  since.setHours(since.getHours() - hours);
  try {
    const result = await paginateConversionLogs(shop.id, {
      cursor,
      take,
      orderBy,
    });
    return jsonApi({
      items: result.items.map(item => ({
        id: item.id,
        orderId: item.orderId,
        orderNumber: item.orderId || null,
        platform: "",
        status: item.status,
        orderValue: 0,
        currency: "USD",
        createdAt: item.createdAt,
        errorMessage: item.status === "pending" ? "Missing value or currency" : null,
      })),
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.items.length,
      },
      filter: {
        hours,
        since: since.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Failed to paginate events", error instanceof Error ? error : new Error(String(error)), {
      shopId: shop.id,
    });
    return jsonApi({ error: "Failed to fetch events" }, { status: 500 });
  }
};
