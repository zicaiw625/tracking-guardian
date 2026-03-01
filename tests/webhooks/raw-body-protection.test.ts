import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("webhook raw body protection", () => {
  it("keeps authenticate.webhook before any request body read", () => {
    const file = readFileSync(resolve(process.cwd(), "app/routes/webhooks.tsx"), "utf8");
    const authIndex = file.indexOf("authenticate.webhook(request)");
    expect(authIndex).toBeGreaterThanOrEqual(0);
    const bodyReaders = [
      "request.json(",
      "request.text(",
      "request.formData(",
      "request.arrayBuffer(",
      "request.blob(",
    ];
    for (const pattern of bodyReaders) {
      const index = file.indexOf(pattern);
      if (index !== -1) {
        expect(index).toBeGreaterThan(authIndex);
      }
    }
  });
});
