import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { jsonApi } from "~/utils/security-headers";
import { getRecentReceipts } from "~/services/recent-receipts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return jsonApi({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get("since");
  const limitRaw = url.searchParams.get("limit");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
  const rows = await getRecentReceipts(shop.id, {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    limit,
  });
  const nextSince = rows.length > 0 ? rows[0].pixelTimestamp : null;
  return jsonApi({ count: rows.length, nextSince, rows });
};
