/**
 * Platform API Mocks
 *
 * Mock implementations for platform APIs (Google, Meta, TikTok).
 */

import { vi, type Mock } from "vitest";

// =============================================================================
// Types
// =============================================================================

export interface MockPlatformResponse {
  success: boolean;
  data?: unknown;
  error?: {
    message: string;
    code?: number | string;
  };
}

export interface MockFetchHandler {
  (url: string, options?: RequestInit): Promise<Response>;
}

// =============================================================================
// Response Factories
// =============================================================================

/**
 * Create a successful Meta CAPI response
 */
export function createMetaSuccessResponse(eventsReceived: number = 1): MockPlatformResponse {
  return {
    success: true,
    data: {
      events_received: eventsReceived,
      fbtrace_id: `mock_fbtrace_${Date.now()}`,
    },
  };
}

/**
 * Create a Meta CAPI error response
 */
export function createMetaErrorResponse(
  message: string,
  code: number = 100
): MockPlatformResponse {
  return {
    success: false,
    error: {
      message,
      code,
    },
  };
}

/**
 * Create a successful Google Analytics response
 */
export function createGoogleSuccessResponse(): MockPlatformResponse {
  return {
    success: true,
    data: {
      validationMessages: [],
    },
  };
}

/**
 * Create a Google Analytics error response
 */
export function createGoogleErrorResponse(message: string): MockPlatformResponse {
  return {
    success: false,
    error: {
      message,
      code: "VALIDATION_ERROR",
    },
  };
}

/**
 * Create a successful TikTok response
 */
export function createTikTokSuccessResponse(): MockPlatformResponse {
  return {
    success: true,
    data: {
      code: 0,
      message: "OK",
    },
  };
}

/**
 * Create a TikTok error response
 */
export function createTikTokErrorResponse(
  message: string,
  code: number = 40001
): MockPlatformResponse {
  return {
    success: false,
    error: {
      message,
      code,
    },
  };
}

// =============================================================================
// Platform API Handlers
// =============================================================================

/**
 * Create mock fetch handler for Meta CAPI
 */
export function createMetaApiHandler(
  response: MockPlatformResponse = createMetaSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Parse request body for validation
    if (options?.body) {
      const body = JSON.parse(options.body as string);
      
      // Validate required fields
      if (!body.data || !Array.isArray(body.data)) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Missing data array",
              type: "OAuthException",
              code: 100,
            },
          }),
          { status: 400 }
        );
      }
    }

    if (response.success) {
      return new Response(JSON.stringify(response.data), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        error: response.error,
      }),
      { status: 400 }
    );
  };
}

/**
 * Create mock fetch handler for Google Analytics
 */
export function createGoogleApiHandler(
  response: MockPlatformResponse = createGoogleSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Validate measurement protocol request
    if (options?.body) {
      const body = JSON.parse(options.body as string);
      
      if (!body.client_id) {
        return new Response(
          JSON.stringify({
            validationMessages: [
              { fieldPath: "client_id", description: "Missing required field" },
            ],
          }),
          { status: 400 }
        );
      }
    }

    if (response.success) {
      return new Response(JSON.stringify(response.data), { status: 204 });
    }

    return new Response(JSON.stringify(response.error), { status: 400 });
  };
}

/**
 * Create mock fetch handler for TikTok Events API
 */
export function createTikTokApiHandler(
  response: MockPlatformResponse = createTikTokSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Validate request
    if (options?.body) {
      const body = JSON.parse(options.body as string);
      
      if (!body.pixel_code) {
        return new Response(
          JSON.stringify({
            code: 40001,
            message: "Missing pixel_code",
          }),
          { status: 400 }
        );
      }
    }

    if (response.success) {
      return new Response(JSON.stringify(response.data), { status: 200 });
    }

    return new Response(
      JSON.stringify({
        code: response.error?.code,
        message: response.error?.message,
      }),
      { status: 400 }
    );
  };
}

// =============================================================================
// Combined Mock Handler
// =============================================================================

/**
 * Create a combined mock fetch handler for all platforms
 */
export function createCombinedPlatformHandler(options: {
  meta?: MockPlatformResponse;
  google?: MockPlatformResponse;
  tiktok?: MockPlatformResponse;
}): MockFetchHandler {
  const metaHandler = createMetaApiHandler(options.meta);
  const googleHandler = createGoogleApiHandler(options.google);
  const tiktokHandler = createTikTokApiHandler(options.tiktok);

  return async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes("graph.facebook.com")) {
      return metaHandler(url, init);
    }
    if (url.includes("google-analytics.com") || url.includes("analyticsdata.googleapis.com")) {
      return googleHandler(url, init);
    }
    if (url.includes("business-api.tiktok.com")) {
      return tiktokHandler(url, init);
    }

    // Unknown URL - return 404
    return new Response("Not Found", { status: 404 });
  };
}

// =============================================================================
// Fetch Mock Setup
// =============================================================================

let originalFetch: typeof globalThis.fetch | null = null;
let mockFetch: Mock | null = null;

/**
 * Setup global fetch mock
 */
export function setupFetchMock(handler?: MockFetchHandler): Mock {
  if (!originalFetch) {
    originalFetch = globalThis.fetch;
  }

  mockFetch = vi.fn(
    handler ||
      createCombinedPlatformHandler({
        meta: createMetaSuccessResponse(),
        google: createGoogleSuccessResponse(),
        tiktok: createTikTokSuccessResponse(),
      })
  );

  globalThis.fetch = mockFetch as typeof fetch;
  return mockFetch;
}

/**
 * Restore original fetch
 */
export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  mockFetch = null;
}

/**
 * Get current mock fetch
 */
export function getMockFetch(): Mock | null {
  return mockFetch;
}

// =============================================================================
// Error Simulation Helpers
// =============================================================================

/**
 * Create a rate limit handler
 */
export function createRateLimitHandler(platform: "meta" | "google" | "tiktok"): MockFetchHandler {
  return async (): Promise<Response> => {
    const responses: Record<string, { body: unknown; status: number }> = {
      meta: {
        body: {
          error: {
            message: "Rate limit exceeded",
            type: "OAuthException",
            code: 17,
          },
        },
        status: 429,
      },
      google: {
        body: { error: "RESOURCE_EXHAUSTED" },
        status: 429,
      },
      tiktok: {
        body: { code: 40100, message: "Rate limit exceeded" },
        status: 429,
      },
    };

    const response = responses[platform];
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Retry-After": "60" },
    });
  };
}

/**
 * Create a timeout handler
 */
export function createTimeoutHandler(delayMs: number = 35000): MockFetchHandler {
  return async (): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    throw new Error("Request timeout");
  };
}

/**
 * Create a network error handler
 */
export function createNetworkErrorHandler(): MockFetchHandler {
  return async (): Promise<Response> => {
    throw new Error("Network error: ECONNREFUSED");
  };
}

// =============================================================================
// Assertion Helpers
// =============================================================================

/**
 * Assert that Meta CAPI was called with correct parameters
 */
export function assertMetaCapiCalled(
  mockFetch: Mock,
  expectedPixelId: string,
  expectedEventName?: string
): void {
  const metaCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
    url.includes("graph.facebook.com")
  );

  expect(metaCalls.length).toBeGreaterThan(0);

  const [url, options] = metaCalls[0];
  expect(url).toContain(expectedPixelId);

  if (expectedEventName && options?.body) {
    const body = JSON.parse(options.body as string);
    expect(body.data[0].event_name).toBe(expectedEventName);
  }
}

/**
 * Assert that Google Analytics was called
 */
export function assertGoogleAnalyticsCalled(
  mockFetch: Mock,
  expectedMeasurementId: string
): void {
  const googleCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
    url.includes("google-analytics.com")
  );

  expect(googleCalls.length).toBeGreaterThan(0);
  expect(googleCalls[0][0]).toContain(expectedMeasurementId);
}

/**
 * Assert that TikTok Events API was called
 */
export function assertTikTokEventsCalled(
  mockFetch: Mock,
  expectedPixelCode?: string
): void {
  const tiktokCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
    url.includes("business-api.tiktok.com")
  );

  expect(tiktokCalls.length).toBeGreaterThan(0);

  if (expectedPixelCode) {
    const [, options] = tiktokCalls[0];
    const body = JSON.parse(options?.body as string);
    expect(body.pixel_code).toBe(expectedPixelCode);
  }
}

