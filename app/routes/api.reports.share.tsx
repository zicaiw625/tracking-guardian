import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { createShareableReport } from "../services/report-sharing.server";
import { logger } from "../utils/logger.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  if (!admin || !session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await request.json();
    const { reportType, reportId, expiresInDays } = body;

    if (!reportType || !reportId) {
      return json({ error: "Missing reportType or reportId" }, { status: 400 });
    }

    const shopQuery = await admin.graphql(`
      query {
        shop {
          id
          myshopifyDomain
        }
      }
    `);

    const shopData = await shopQuery.json() as { data?: { shop?: { id?: string; myshopifyDomain?: string } }; errors?: Array<{ message?: string }> };

    if (shopData.errors || !shopData.data?.shop) {
      return json({ error: "Shop not found" }, { status: 404 });
    }

    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });

    if (!shopRecord) {
      return json({ error: "Shop record not found" }, { status: 404 });
    }

    const result = await createShareableReport({
      shopId: shopRecord.id,
      reportType,
      reportId,
      expiresInDays: expiresInDays || 7,
    });

    logger.info("Shareable report created", {
      shopDomain: session.shop,
      reportType,
      reportId,
      shareToken: result.shareToken,
    });

    return json({
      success: true,
      shareUrl: result.shareUrl,
      shareToken: result.shareToken,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error("Failed to create shareable report", {
      shopDomain: session.shop,
      error: error instanceof Error ? error.message : String(error),
    });
    return json(
      {
        error: error instanceof Error ? error.message : "Failed to create shareable report",
      },
      { status: 500 }
    );
  }
};
