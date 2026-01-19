import { describe, it, expect } from "vitest";
import { isPublicUrl } from "../../app/utils/security";

describe("isPublicUrl", () => {
  describe("rejects private or local IPv6 and IPv4-mapped", () => {
    it("rejects https://[::1]/", () => {
      expect(isPublicUrl("https://[::1]/")).toBe(false);
    });
    it("rejects https://[::1]/path", () => {
      expect(isPublicUrl("https://[::1]/path")).toBe(false);
    });
    it("rejects https://[fc00::1]/", () => {
      expect(isPublicUrl("https://[fc00::1]/")).toBe(false);
    });
    it("rejects https://[fd00::1]/", () => {
      expect(isPublicUrl("https://[fd00::1]/")).toBe(false);
    });
    it("rejects https://[fe80::1]/", () => {
      expect(isPublicUrl("https://[fe80::1]/")).toBe(false);
    });
    it("rejects https://[::ffff:127.0.0.1]/", () => {
      expect(isPublicUrl("https://[::ffff:127.0.0.1]/")).toBe(false);
    });
    it("rejects https://[::ffff:10.0.0.1]/", () => {
      expect(isPublicUrl("https://[::ffff:10.0.0.1]/")).toBe(false);
    });
    it("rejects https://[::ffff:192.168.1.1]/", () => {
      expect(isPublicUrl("https://[::ffff:192.168.1.1]/")).toBe(false);
    });
    it("rejects https://[::ffff:172.16.0.1]/", () => {
      expect(isPublicUrl("https://[::ffff:172.16.0.1]/")).toBe(false);
    });
    it("rejects https://[fe80::1%25lo0]/ (zone id)", () => {
      expect(isPublicUrl("https://[fe80::1%25lo0]/")).toBe(false);
    });
    it("rejects https://[::]/", () => {
      expect(isPublicUrl("https://[::]/")).toBe(false);
    });
    it("rejects https://[2001:db8::1]/", () => {
      expect(isPublicUrl("https://[2001:db8::1]/")).toBe(false);
    });
  });

  describe("accepts public URLs", () => {
    it("accepts https://example.com/", () => {
      expect(isPublicUrl("https://example.com/")).toBe(true);
    });
    it("accepts https://[2001:4860:4860::8888]/", () => {
      expect(isPublicUrl("https://[2001:4860:4860::8888]/")).toBe(true);
    });
  });
});
