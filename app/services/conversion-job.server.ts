import { JOB_PROCESSING_CONFIG } from "../utils/config.server";

const { BASE_DELAY_MS, MAX_DELAY_MS, BACKOFF_MULTIPLIER } = JOB_PROCESSING_CONFIG;

export function calculateNextRetryTime(attempts: number): Date {
  const delayMs = Math.min(BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1), MAX_DELAY_MS);
  const jitter = delayMs * 0.1 * Math.random();
  return new Date(Date.now() + delayMs + jitter);
}

export {
  processConversionJobs,
  type ProcessConversionJobsResult,
  getBatchBackoffDelay,
} from './job-processor.server';
