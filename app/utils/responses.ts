/**
 * HTTP Response Utilities
 *
 * Type-safe utilities for creating JSON responses without type casting.
 * Replaces `as unknown as Response` patterns throughout the codebase.
 */

// =============================================================================
// Core Response Builders
// =============================================================================

/**
 * Create a JSON response with proper typing.
 * This replaces the pattern: `json({ ... }) as unknown as Response`
 */
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

/**
 * Create an error response
 */
export function createErrorResponse(
  error: string,
  status: number = 400,
  headers?: HeadersInit
): Response {
  return createJsonResponse({ error }, { status, headers });
}

/**
 * Create a success response with message
 */
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

// =============================================================================
// Common HTTP Error Responses
// =============================================================================

/**
 * Create a 400 Bad Request response
 */
export function badRequestResponse(error: string): Response {
  return createErrorResponse(error, 400);
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(error: string = "Unauthorized"): Response {
  return createErrorResponse(error, 401);
}

/**
 * Create a 403 Forbidden response
 */
export function forbiddenResponse(error: string = "Forbidden"): Response {
  return createErrorResponse(error, 403);
}

/**
 * Create a 404 Not Found response
 */
export function notFoundResponse(error: string = "Not Found"): Response {
  return createErrorResponse(error, 404);
}

/**
 * Create a 500 Internal Server Error response
 */
export function internalServerErrorResponse(error: string = "Internal Server Error"): Response {
  return createErrorResponse(error, 500);
}

/**
 * Create a 503 Service Unavailable response
 */
export function serviceUnavailableResponse(error: string = "Service Unavailable"): Response {
  return createErrorResponse(error, 503);
}

// =============================================================================
// Cron-Specific Responses
// =============================================================================

/**
 * Create a cron success response
 */
export function cronSuccessResponse<T extends Record<string, unknown>>(
  data: T & { requestId: string; durationMs: number }
): Response {
  return createJsonResponse({
    success: true,
    message: "Cron completed",
    ...data,
  });
}

/**
 * Create a cron skipped response (lock held by another instance)
 */
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

/**
 * Create a cron error response
 */
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

// =============================================================================
// API-Specific Responses
// =============================================================================

/**
 * Create a pixel event success response
 */
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

/**
 * Create a survey submission success response
 */
export function surveySuccessResponse(message: string = "Survey submitted successfully"): Response {
  return createJsonResponse({
    success: true,
    message,
  });
}

// =============================================================================
// Export Response
// =============================================================================

/**
 * Create a data export response with appropriate headers
 */
export function createExportResponse(
  data: unknown,
  filename: string
): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers,
  });
}

/**
 * Create a CSV export response
 */
export function createCsvExportResponse(
  csv: string,
  filename: string
): Response {
  const headers = new Headers();
  headers.set("Content-Type", "text/csv");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);

  return new Response(csv, {
    status: 200,
    headers,
  });
}

// =============================================================================
// Redirect Responses
// =============================================================================

/**
 * Create a redirect response
 */
export function redirectResponse(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: url,
    },
  });
}

// =============================================================================
// No Content Response
// =============================================================================

/**
 * Create a 204 No Content response
 */
export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Create a 202 Accepted response
 */
export function acceptedResponse<T extends Record<string, unknown>>(data?: T): Response {
  if (data) {
    return createJsonResponse(data, { status: 202 });
  }
  return new Response(null, { status: 202 });
}

