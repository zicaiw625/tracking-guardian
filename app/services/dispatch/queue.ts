import { randomUUID } from "crypto";
import prisma from "~/db.server";

const BACKOFF_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;
const DEFAULT_PROCESSING_STALE_MS = 15 * 60 * 1000;

export type DispatchDestination = "GA4" | "META" | "TIKTOK";
export type DispatchJobStatus = "PENDING" | "SENT" | "FAILED" | "PROCESSING";

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
    ip_encrypted?: string | null;
    user_agent: string | null;
    user_agent_encrypted?: string | null;
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

export async function listPendingJobs(limit: number, now: Date): Promise<ListPendingJobsResult[]> {
  // Use SKIP LOCKED to avoid race conditions between workers
  // This requires raw query as Prisma doesn't support SKIP LOCKED natively in findMany yet
  const lockedJobs = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "EventDispatchJob"
    SET status = 'PROCESSING', "updatedAt" = NOW()
    WHERE id IN (
      SELECT id FROM "EventDispatchJob"
      WHERE status = 'PENDING' AND next_retry_at <= ${now}
      ORDER BY next_retry_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;

  const jobIds = lockedJobs.map((j) => j.id);

  if (jobIds.length === 0) {
    return [];
  }

  const jobs = await prisma.eventDispatchJob.findMany({
    where: {
      id: { in: jobIds },
    },
    include: { InternalEvent: true },
  });

  return jobs as ListPendingJobsResult[];
}

export async function recoverStuckProcessingJobs(options?: { maxAgeMs?: number; now?: Date }): Promise<number> {
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_PROCESSING_STALE_MS;
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - maxAgeMs);

  const result = await prisma.eventDispatchJob.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "PENDING",
      next_retry_at: now,
      updatedAt: now,
      last_error: "Recovered stale PROCESSING job (worker crash/timeout suspected)",
      last_response_code: null,
    },
  });

  return result.count;
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

export async function createDispatchJob(internalEventId: string, destination: DispatchDestination): Promise<string> {
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
