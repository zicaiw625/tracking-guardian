import { describe, expect, it } from "vitest";
import { normalizeExtensionUrl } from "../../extensions/post-checkout-badge/src/url";

describe("normalizeExtensionUrl", () => {
  it("accepts https url", () => {
    expect(normalizeExtensionUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("accepts relative path", () => {
    expect(normalizeExtensionUrl("/orders/123")).toBe("/orders/123");
  });

  it("rejects javascript url", () => {
    expect(normalizeExtensionUrl("javascript:alert(1)")).toBe("");
  });

  it("rejects protocol-relative url", () => {
    expect(normalizeExtensionUrl("//evil.com")).toBe("");
  });
});
