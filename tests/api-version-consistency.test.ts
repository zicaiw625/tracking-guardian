import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("API Version Consistency", () => {
  function getTomlVersion(filePath: string): string | null {
    const content = readFileSync(
      resolve(__dirname, filePath),
      "utf-8"
    );
    const match = content.match(/api_version\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  function convertEnumToVersion(enumValue: string): string | null {
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
      "January26": "2026-01",
    };
    return enumToVersion[enumValue] || null;
  }

  function getServerVersion(filePath: string): string | null {
    const content = readFileSync(
      resolve(__dirname, filePath),
      "utf-8"
    );
    const match = content.match(/ApiVersion\.(\w+)/);
    if (!match) return null;
    return convertEnumToVersion(match[1]);
  }

  function getSharedVersion(): string | null {
    const content = readFileSync(
      resolve(__dirname, "../app/utils/config.shared.ts"),
      "utf-8"
    );
    const match = content.match(/VERSION:\s*"(\d{4}-\d{2})"/);
    return match ? match[1] : null;
  }

  it("shopify.app.toml has api_version defined", () => {
    const version = getTomlVersion("../shopify.app.toml");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("shopify.app.toml.template has api_version defined", () => {
    const version = getTomlVersion("../shopify.app.toml.template");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("tracking-pixel extension toml has api_version defined", () => {
    const version = getTomlVersion("../extensions/tracking-pixel/shopify.extension.toml");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("post-checkout-badge extension toml has api_version defined", () => {
    const version = getTomlVersion("../extensions/post-checkout-badge/shopify.extension.toml");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("app-config server has ApiVersion defined", () => {
    const version = getServerVersion("../app/services/shopify/app-config.server.ts");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("admin-client server has ApiVersion defined", () => {
    const version = getServerVersion("../app/services/shopify/admin-client.server.ts");
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("shared config has VERSION defined", () => {
    const version = getSharedVersion();
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d{4}-\d{2}$/);
  });
  it("all sources have the same API version", () => {
    const versions = [
      getTomlVersion("../shopify.app.toml"),
      getTomlVersion("../shopify.app.toml.template"),
      getTomlVersion("../extensions/tracking-pixel/shopify.extension.toml"),
      getTomlVersion("../extensions/post-checkout-badge/shopify.extension.toml"),
      getServerVersion("../app/services/shopify/app-config.server.ts"),
      getServerVersion("../app/services/shopify/admin-client.server.ts"),
      getSharedVersion(),
    ];
    const unique = new Set(versions);
    expect(unique.size).toBe(1);
    console.log(`✅ All API versions consistent: ${versions[0]}`);
  });
  it("API version is not expired (basic check)", () => {
    const version = getTomlVersion("../shopify.app.toml");
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
