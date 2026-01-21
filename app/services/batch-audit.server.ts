export async function startBatchAudit(_options: {
  groupId: string;
  requesterId: string;
  concurrency?: number;
  skipRecentHours?: number;
}): Promise<{ error: string } | { jobId: string }> {
  return Promise.resolve({ jobId: "" });
}

export function getBatchAuditStatus(_jobId: string): { id: string; groupId: string } | null {
  return null;
}

export function getBatchAuditHistory(_limit: number): Array<{ createdAt: Date }> {
  return [];
}

export function getBatchAuditStatistics(): {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  runningJobs: number;
  avgSuccessRate: number;
} {
  return {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    runningJobs: 0,
    avgSuccessRate: 0,
  };
}

export function cleanupOldJobs(_maxAgeMs: number): number {
  return 0;
}
