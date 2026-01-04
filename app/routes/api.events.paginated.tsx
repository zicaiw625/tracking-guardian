/**
 * P2-9: 分页事件日志 API
 * 
 * 使用 cursor-based pagination 提供高性能的事件日志查询。
 * 默认只返回最近 24 小时的数据，避免加载过多数据。
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { paginateConversionLogs } from "../services/db/query-optimizer.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const take = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100); // 最多 100 条
  const orderBy = (url.searchParams.get("orderBy") || "desc") as "asc" | "desc";
  
  // P2-9: 默认只查询最近 24 小时的数据
  const hours = parseInt(url.searchParams.get("hours") || "24", 10);
  const since = new Date();
  since.setHours(since.getHours() - hours);

  try {
    // 使用 cursor-based pagination
    const result = await paginateConversionLogs(shop.id, {
      cursor,
      take,
      orderBy,
    });

    // 获取完整的事件详情（仅返回当前页的数据）
    const eventIds = result.items.map((item) => item.id);
    const events = await prisma.conversionLog.findMany({
      where: {
        id: { in: eventIds },
        createdAt: { gte: since }, // 只返回最近 N 小时的数据
      },
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        platform: true,
        status: true,
        orderValue: true,
        currency: true,
        createdAt: true,
        errorMessage: true,
      },
      orderBy: { createdAt: orderBy },
    });

    return json({
      items: events,
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: events.length,
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
    return json({ error: "Failed to fetch events" }, { status: 500 });
  }
};

