export function shouldRecordRejection(isProduction: boolean, isBlocking: boolean): boolean {
  if (!isProduction) return true;
  if (isBlocking) return true;
  const rate = parseFloat(process.env.PIXEL_INGEST_STATS_SAMPLING ?? "0.01");
  return Math.random() < rate;
}
