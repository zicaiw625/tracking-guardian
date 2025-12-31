import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getBatchJobStatus } from "../services/batch-job-queue.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const { jobId } = params;
  if (!jobId) {
    return json({ error: "Job ID is required" }, { status: 400 });
  }

  const jobStatus = getBatchJobStatus(jobId);

  if (!jobStatus) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  return json(jobStatus);
};

