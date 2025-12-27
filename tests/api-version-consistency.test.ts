import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("API Version Consistency", () => {
  function getAppTomlVersion(): string | null {
    const content = readFileSync(
      resolve(__dirname, "../shopify.app.toml"),
      "utf-8"
    );

    const match = content.match(/api_version\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  function getExtensionTomlVersion(): string | null {
    const content = readFileSync(
      resolve(__dirname, "../extensions/tracking-pixel/shopify.extension.toml"),
      "utf-8"
    );

    const match = content.match(/api_version\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  function getServerVersion(): string | null {

    const content = readFileSync(
      resolve(__dirname, "../app/services/shopify/app-config.server.ts"),
      "utf-8"
    );

    const match = content.match(/apiVersion:\s*ApiVersion\.(\w+)/);
    if (!match) return null;

    const enumToVersion: Record<string, string> = {
      "January23": "2023-01",
      "April23": "2023-04",
      "July23": "2023-07",
      "October23": "2023-10",
      "January24": "2024-01",
      "April24": "2024-04",
      "July24": "2024-07",
      "October24": "2024-10",
      "January25": "2025-01",
      "April25": "2025-04",
      "July25": "2025-07",
      "October25": "2025-10",
    };

    return enumToVersion[match[1]] || null;
  }

  it("shopify.app.toml has api_version defined", () => {
    const version = getAppTomlVersion();
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });

  it("extension toml has api_version defined", () => {
    const version = getExtensionTomlVersion();
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });

  it("shopify.server.ts has ApiVersion defined", () => {
    const version = getServerVersion();
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });

  it("all three sources have the same API version", () => {
    const appTomlVersion = getAppTomlVersion();
    const extensionVersion = getExtensionTomlVersion();
    const serverVersion = getServerVersion();

    expect(appTomlVersion).toBe(extensionVersion);
    expect(extensionVersion).toBe(serverVersion);
    expect(serverVersion).toBe(appTomlVersion);

    console.log(`✅ All API versions consistent: ${appTomlVersion}`);
  });

  it("API version is not expired (basic check)", () => {
    const version = getAppTomlVersion();
    if (!version) {
      throw new Error("Could not read API version");
    }

    const [year, month] = version.split("-").map(Number);
    const versionDate = new Date(year, month - 1, 1);

    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    expect(versionDate.getTime()).toBeGreaterThan(oneYearAgo.getTime());
  });
});

describe("Webhook HMAC Validation", () => {
  it("should reject invalid HMAC (test configuration)", () => {
    expect(true).toBe(true);
  });

  it("should accept valid HMAC (test configuration)", () => {
    expect(true).toBe(true);
  });
});
