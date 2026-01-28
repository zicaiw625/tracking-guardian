export function createJsonResponse<T extends Record<string, unknown>>(
  data: T,
  options?: {
    status?: number;
    headers?: HeadersInit;
  }
): Response {
  const status = options?.status ?? 200;
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function createErrorResponse(
  error: string,
  status: number = 400,
  headers?: HeadersInit
): Response {
  return createJsonResponse({ error }, { status, headers });
}

export function createSuccessResponse<T extends Record<string, unknown>>(
  data: T & { success?: boolean; message?: string },
  status: number = 200,
  headers?: HeadersInit
): Response {
  return createJsonResponse(
    { success: true, ...data },
    { status, headers }
  );
}

export function badRequestResponse(error: string): Response {
  return createErrorResponse(error, 400);
}

export function unauthorizedResponse(error: string = "Unauthorized"): Response {
  return createErrorResponse(error, 401);
}

export function forbiddenResponse(error: string = "Forbidden"): Response {
  return createErrorResponse(error, 403);
}

export function notFoundResponse(error: string = "Not Found"): Response {
  return createErrorResponse(error, 404);
}

export function internalServerErrorResponse(error: string = "Internal Server Error"): Response {
  return createErrorResponse(error, 500);
}

export function serviceUnavailableResponse(error: string = "Service Unavailable"): Response {
  return createErrorResponse(error, 503);
}

export function cronSuccessResponse<T extends Record<string, unknown>>(
  data: T & { requestId: string; durationMs: number }
): Response {
  return createJsonResponse({
    success: true,
    message: "Cron completed",
    ...data,
  });
}

export function cronSkippedResponse(
  requestId: string,
  durationMs: number,
  reason?: string
): Response {
  return createJsonResponse({
    success: true,
    skipped: true,
    message: "Cron skipped - another instance is already running",
    reason,
    requestId,
    durationMs,
  });
}

export function cronErrorResponse(
  requestId: string,
  durationMs: number,
  error: string,
  status: number = 500
): Response {
  return createJsonResponse(
    {
      success: false,
      error,
      requestId,
      durationMs,
    },
    { status }
  );
}

export function pixelEventSuccessResponse(data: {
  eventId?: string;
  received?: boolean;
  message?: string;
}): Response {
  return createJsonResponse({
    success: true,
    ...data,
  });
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function createExportResponse(
  data: unknown,
  filename: string
): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(filename)}"`);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers,
  });
}

export function createCsvExportResponse(
  csv: string,
  filename: string
): Response {
  const headers = new Headers();
  headers.set("Content-Type", "text/csv");
  headers.set("Content-Disposition", `attachment; filename="${sanitizeFilename(filename)}"`);
  return new Response(csv, {
    status: 200,
    headers,
  });
}

export function redirectResponse(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url,
    },
  });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

export function acceptedResponse<T extends Record<string, unknown>>(data?: T): Response {
  if (data) {
    return createJsonResponse(data, { status: 202 });
  }
  return new Response(null, { status: 202 });
}
