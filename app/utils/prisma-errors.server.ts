export function isMissingColumnError(error: unknown, model: string, column: string): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code !== "P2022") return false;
  const message = typeof e.message === "string" ? e.message : "";
  const needle = `The column \`${model}.${column}\` does not exist`;
  return message.includes(needle);
}

