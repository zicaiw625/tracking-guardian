/**
 * P2-9: 报表任务状态查询 API
 * 
 * 客户端通过此端点轮询报表生成任务的状态。
 */

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getReportJobStatus } from "../services/report-job.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const jobId = params.jobId;
  if (!jobId) {
    return json({ error: "Job ID required" }, { status: 400 });
  }

  const job = await getReportJobStatus(jobId);

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  // 验证任务属于当前店铺
  if (job.shopId !== shop.id) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  return json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    resultUrl: job.resultUrl,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  });
};

