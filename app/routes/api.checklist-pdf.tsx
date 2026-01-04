
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { generateMigrationChecklist } from "../services/migration-checklist.server";
import { generateMigrationChecklistPDF } from "../services/pdf-export.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true },
    });

    if (!shop) {
      return new Response("Shop not found", { status: 404 });
    }

    const checklist = await generateMigrationChecklist(shop.id);

    const pdfBuffer = await generateMigrationChecklistPDF(checklist, shop.shopDomain);

    const filename = `migration-checklist-${shop.shopDomain}-${new Date().toISOString().split("T")[0]}.pdf`;

    return new Response((pdfBuffer instanceof Buffer ? pdfBuffer : Buffer.from(pdfBuffer)) as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error("Failed to generate PDF checklist", { error });

    if (error instanceof Error && error.message.includes("pdfkit")) {
      return new Response(
        JSON.stringify({
          error: "PDF 导出功能需要安装 pdfkit 依赖。请运行: pnpm add pdfkit @types/pdfkit",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "生成 PDF 失败",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

