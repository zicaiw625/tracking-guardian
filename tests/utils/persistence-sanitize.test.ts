import { describe, it, expect } from "vitest";
import { sanitizeForPersistence, sanitizePrismaWriteArgs } from "../../app/utils/persistence-sanitize.server";

describe("sanitizeForPersistence", () => {
  it("drops common PII keys and redacts secrets", () => {
    const input = {
      email: "a@example.com",
      phone: "+1",
      authorization: "Bearer xyz",
      access_token: "tok",
      url: "https://shop.example.com/path?q=1#h",
      data: {
        ip_address: "1.2.3.4",
        nested: { refresh_token: "rtok", ok: true },
      },
      ok: 1,
    };
    const out = sanitizeForPersistence(input) as Record<string, unknown>;
    expect(out.email).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.authorization).toBe("***REDACTED***");
    expect(out.access_token).toBe("***REDACTED***");
    expect(out.url).toBe("https://shop.example.com/path");
    expect((out.data as Record<string, unknown>).ip_address).toBeUndefined();
    expect(((out.data as Record<string, unknown>).nested as Record<string, unknown>).refresh_token).toBe("***REDACTED***");
    expect(out.ok).toBe(1);
  });
});

describe("sanitizePrismaWriteArgs", () => {
  it("sanitizes only known Json field names in Prisma args", () => {
    const args: Record<string, unknown> = {
      data: {
        payloadJson: { email: "a@example.com", value: 1 },
        name: "keep",
        Shop: { connect: { id: "s1" } },
      },
    };
    sanitizePrismaWriteArgs("create", args);
    const data = args.data as Record<string, unknown>;
    const payloadJson = data.payloadJson as Record<string, unknown>;
    expect(payloadJson.email).toBeUndefined();
    expect(payloadJson.value).toBe(1);
    expect(data.name).toBe("keep");
    expect(data.Shop).toEqual({ connect: { id: "s1" } });
  });
});

