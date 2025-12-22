
import { vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_SECRET = "test-encryption-secret-key-for-testing";
process.env.CRON_SECRET = "test-cron-secret";
process.env.SHOPIFY_APP_URL = "https://test-app.example.com";

if (typeof globalThis.crypto === "undefined") {
  
  globalThis.crypto = {
    subtle: {
      digest: async (_algorithm: string, data: Uint8Array) => {
        
        const { createHash } = await import("crypto");
        const hash = createHash("sha256");
        hash.update(Buffer.from(data));
        return hash.digest().buffer;
      },
    },
    getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
      if (array) {
        const bytes = array as unknown as Uint8Array;
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      return array;
    },
  };
}

export function createMockRequest(
  url: string,
  options: RequestInit & { headers?: Record<string, string> } = {}
): Request {
  const headers = new Headers(options.headers || {});
  return new Request(url, {
    ...options,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});
