import { randomUUID } from "crypto";
import prisma from "~/db.server";

const BACKOFF_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export type DispatchDestination = "GA4" | "META" | "TIKTOK";
export type DispatchJobStatus = "PENDING" | "SENT" | "FAILED";

export interface ListPendingJobsResult {
  id: string;
  internal_event_id: string;
  destination: string;
  status: string;
  attempts: number;
  next_retry_at: Date;
  InternalEvent: {
    id: string;
    shopId: string;
    source: string;
    event_name: string;
    event_id: string;
    client_id: string | null;
    timestamp: bigint;
    occurred_at: Date;
    ip: string | null;
    user_agent: string | null;
    page_url: string | null;
    referrer: string | null;
    querystring: string | null;
    currency: string | null;
    value: unknown;
    transaction_id: string | null;
    items: unknown;
    user_data_hashed: unknown;
    consent_purposes: unknown;
    environment: string;
  };
}

export async function listPendingJobs(
  limit: number,
  now: Date
): Promise<ListPendingJobsResult[]> {
  const jobs = await prisma.eventDispatchJob.findMany({
    where: {
      status: "PENDING",
      next_retry_at: { lte: now },
    },
    orderBy: { next_retry_at: "asc" },
    take: limit,
    include: { InternalEvent: true },
  });
  return jobs as ListPendingJobsResult[];
}

export function computeNextRetryAt(attempts: number): Date | null {
  if (attempts > MAX_ATTEMPTS) return null;
  const index = Math.max(0, attempts - 1);
  const minutes = BACKOFF_MINUTES[index] ?? 120;
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

export async function markSent(id: string): Promise<void> {
  await prisma.eventDispatchJob.update({
    where: { id },
    data: { status: "SENT", updatedAt: new Date() },
  });
}

export async function markFailed(
  id: string,
  lastError: string,
  lastResponseCode: number | null,
  attempts: number
): Promise<void> {
  const nextRetryAt = computeNextRetryAt(attempts);
  const status = nextRetryAt === null ? "FAILED" : "PENDING";
  await prisma.eventDispatchJob.update({
    where: { id },
    data: {
      status,
      attempts,
      next_retry_at: nextRetryAt ?? new Date(0),
      last_error: lastError,
      last_response_code: lastResponseCode,
      updatedAt: new Date(),
    },
  });
}

export async function createDispatchJob(
  internalEventId: string,
  destination: DispatchDestination
): Promise<string> {
  const id = randomUUID();
  await prisma.eventDispatchJob.create({
    data: {
      id,
      internal_event_id: internalEventId,
      destination,
      status: "PENDING",
      attempts: 0,
      next_retry_at: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}
