import { logger } from "../../utils/logger.server";
import type {
  ProcessGDPRJobResult,
  ProcessGDPRJobsResult,
} from "./types";

export async function processGDPRJob(_jobId: string): Promise<ProcessGDPRJobResult> {
  logger.warn("[GDPR] processGDPRJob called but GDPR job queue is no longer supported. GDPR requests are now processed synchronously via webhook handlers.");
  return { success: false, error: "GDPR job queue is no longer supported" };
}

export async function processGDPRJobs(): Promise<ProcessGDPRJobsResult> {
  logger.warn("[GDPR] processGDPRJobs called but GDPR job queue is no longer supported. GDPR requests are now processed synchronously via webhook handlers.");
  return { processed: 0, succeeded: 0, failed: 0 };
}

export async function getGDPRJobStatus(_shopDomain?: string): Promise<{
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  recentJobs: Array<{
    id: string;
    shopDomain: string;
    jobType: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}> {
  logger.warn("[GDPR] getGDPRJobStatus called but GDPR job queue is no longer supported. GDPR requests are now processed synchronously via webhook handlers.");
  return {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    recentJobs: [],
  };
}
