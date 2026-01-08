import { vi, type Mock } from "vitest";

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

export function createMetaSuccessResponse(eventsReceived: number = 1): MockPlatformResponse {
  return {
    success: true,
    data: {
      events_received: eventsReceived,
      fbtrace_id: `mock_fbtrace_${Date.now()}`,
    },
  };
}

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

export function createGoogleSuccessResponse(): MockPlatformResponse {
  return {
    success: true,
    data: {
      validationMessages: [],
    },
  };
}

export function createGoogleErrorResponse(message: string): MockPlatformResponse {
  return {
    success: false,
    error: {
      message,
      code: "VALIDATION_ERROR",
    },
  };
}

export function createTikTokSuccessResponse(): MockPlatformResponse {
  return {
    success: true,
    data: {
      code: 0,
      message: "OK",
    },
  };
}

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

export function createMetaApiHandler(
  response: MockPlatformResponse = createMetaSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {

    await new Promise((resolve) => setTimeout(resolve, 10));

    if (options?.body) {
      const body = JSON.parse(options.body as string);

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

export function createGoogleApiHandler(
  response: MockPlatformResponse = createGoogleSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, 10));

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

export function createTikTokApiHandler(
  response: MockPlatformResponse = createTikTokSuccessResponse()
): MockFetchHandler {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, 10));

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

    return new Response("Not Found", { status: 404 });
  };
}

let originalFetch: typeof globalThis.fetch | null = null;
let mockFetch: Mock | null = null;

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

export function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  mockFetch = null;
}

export function getMockFetch(): Mock | null {
  return mockFetch;
}

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

export function createTimeoutHandler(delayMs: number = 35000): MockFetchHandler {
  return async (): Promise<Response> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    throw new Error("Request timeout");
  };
}

export function createNetworkErrorHandler(): MockFetchHandler {
  return async (): Promise<Response> => {
    throw new Error("Network error: ECONNREFUSED");
  };
}

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
