import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { getPlatformService } from "./platforms/factory";
import type { ConversionJob } from "@prisma/client";

export interface ProcessConversionJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ jobId: string; error: string }>;
}

const BATCH_SIZE = 10;
const MAX_RETRIES = 5;

export async function processConversionJobs(
  shopId?: string,
  limit: number = BATCH_SIZE
): Promise<ProcessConversionJobsResult> {
  const result: ProcessConversionJobsResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  try {
    const jobs = await prisma.conversionJob.findMany({
      where: {
        ...(shopId ? { shopId } : {}),
        status: { in: ["queued", "retrying"] },
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: new Date() } },
        ],
      },
      take: limit,
      include: {
        Shop: {
          select: {
            shopDomain: true,
            plan: true,
            consentStrategy: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    for (const job of jobs) {
      result.processed++;
      try {
        await processSingleJob(job);
        result.succeeded++;
      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({ jobId: job.id, error: errorMessage });
        logger.error("Failed to process conversion job", {
          jobId: job.id,
          shopId: job.shopId,
          error: errorMessage,
        });
      }
    }
  } catch (error) {
    logger.error("Error processing conversion jobs", { error });
  }
  return result;
}

async function processSingleJob(job: ConversionJob & { Shop: { shopDomain: string; plan: string; consentStrategy: string } }): Promise<void> {
  await prisma.conversionJob.update({
    where: { id: job.id },
    data: { status: "processing", processedAt: new Date() },
  });
  try {
    if (!job.capiInput) {
      throw new Error("Missing capiInput");
    }
    const capiInput = job.capiInput as { platform: string; [key: string]: unknown };
    const platform = capiInput.platform;
    if (!platform) {
      throw new Error("Missing platform in capiInput");
    }
    const platformService = getPlatformService(platform);
    if (!platformService) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    const response = await platformService.sendConversion({
      orderId: job.orderId,
      orderValue: Number(job.orderValue),
      currency: job.currency,
      ...capiInput,
    });
    await prisma.conversionJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        platformResults: {
          [platform]: {
            success: true,
            response,
          },
        },
      },
    });
    await prisma.conversionLog.create({
      data: {
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        shopId: job.shopId,
        orderId: job.orderId,
        orderNumber: job.orderNumber,
        orderValue: job.orderValue,
        currency: job.currency,
        platform,
        eventType: "purchase",
        status: "sent",
        sentAt: new Date(),
        serverSideSent: true,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts + 1;
    if (attempts >= MAX_RETRIES) {
      await prisma.conversionJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts,
          errorMessage,
        },
      });
    } else {
      const nextRetryAt = new Date(Date.now() + Math.pow(2, attempts) * 1000);
      await prisma.conversionJob.update({
        where: { id: job.id },
        data: {
          status: "retrying",
          attempts,
          nextRetryAt,
          errorMessage,
        },
      });
    }
    throw error;
  }
}

export function getBatchBackoffDelay(batchNumber: number): number {
  return Math.min(1000 * Math.pow(2, batchNumber), 30000);
}
