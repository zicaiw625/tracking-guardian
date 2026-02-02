/**
 * Shared CSV sanitization and escaping for export/upload.
 * Safe to use on client and server. Use for any user or external data
 * written into CSV to avoid formula injection and delimiter breaks.
 */

export function sanitizeForCSV(value: string): string {
  if (typeof value !== "string") {
    value = String(value);
  }
  const trimmed = value.trim();
  if (trimmed.length > 0 && /^[=+\-@]/.test(trimmed)) {
    return `'${value}`;
  }
  return value;
}

export function escapeCSV(value: string): string {
  const sanitized = sanitizeForCSV(value);
  if (sanitized.includes(",") || sanitized.includes('"') || sanitized.includes("\n")) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}
