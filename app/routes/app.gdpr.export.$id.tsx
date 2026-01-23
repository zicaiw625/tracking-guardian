import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { addSecurityHeaders } from "../utils/security-headers";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const id = params.id;
  if (!id) {
    return addSecurityHeaders(new Response("Not found", { status: 404 }));
  }
  const job = await prisma.gDPRJob.findUnique({
    where: { id },
    select: {
      id: true,
      shopDomain: true,
      jobType: true,
      status: true,
      payload: true,
      result: true,
      errorMessage: true,
      createdAt: true,
      processedAt: true,
      completedAt: true,
    },
  });
  if (!job || job.shopDomain !== shopDomain) {
    return addSecurityHeaders(new Response("Not found", { status: 404 }));
  }
  const body = JSON.stringify({
    ...job,
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt,
    processedAt: job.processedAt?.toISOString?.() ?? job.processedAt ?? null,
    completedAt: job.completedAt?.toISOString?.() ?? job.completedAt ?? null,
  });
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set(
    "Content-Disposition",
    `attachment; filename="gdpr_${job.jobType}_${job.id}.json"`
  );
  return addSecurityHeaders(new Response(body, { status: 200, headers }));
};

