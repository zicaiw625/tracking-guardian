import { afterEach, describe, expect, it } from "vitest";
import { getPublicAppDomain } from "../../app/utils/config.server";

const originalEnv = process.env;

describe("getPublicAppDomain", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns configured SHOPIFY_APP_URL when present", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      SHOPIFY_APP_URL: "https://example.app",
      APP_URL: "",
    };
    expect(getPublicAppDomain()).toBe("https://example.app");
  });

  it("throws in production when domain is not configured", () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      SHOPIFY_APP_URL: "",
      APP_URL: "",
    };
    expect(() => getPublicAppDomain()).toThrow(/Missing public app domain/);
  });
});
