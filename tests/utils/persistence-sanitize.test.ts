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

  it("should not persist sensitive PII fields", () => {
    const input = {
      email: "user@example.com",
      phone: "+1234567890",
      phone_number: "+9876543210",
      first_name: "John",
      last_name: "Doe",
      full_name: "John Doe",
      address: "123 Main St",
      city: "New York",
      state: "NY",
      zip: "10001",
      country: "US",
      ip: "192.168.1.1",
      ip_address: "10.0.0.1",
      user_agent: "Mozilla/5.0",
    };
    const out = sanitizeForPersistence(input) as Record<string, unknown>;
    expect(out.email).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.phone_number).toBeUndefined();
    expect(out.first_name).toBeUndefined();
    expect(out.last_name).toBeUndefined();
    expect(out.full_name).toBeUndefined();
    expect(out.address).toBeUndefined();
    expect(out.city).toBeUndefined();
    expect(out.state).toBeUndefined();
    expect(out.zip).toBeUndefined();
    expect(out.country).toBeUndefined();
    expect(out.ip).toBeUndefined();
    expect(out.ip_address).toBeUndefined();
    expect(out.user_agent).toBeUndefined();
  });

  it("should not persist sensitive tokens and secrets", () => {
    const input = {
      access_token: "token123",
      refresh_token: "refresh456",
      id_token: "id789",
      client_secret: "secret123",
      api_key: "key456",
      api_secret: "secret789",
      password: "pass123",
      authorization: "Bearer xyz",
      cookie: "session=abc",
    };
    const out = sanitizeForPersistence(input) as Record<string, unknown>;
    expect(out.access_token).toBe("***REDACTED***");
    expect(out.refresh_token).toBe("***REDACTED***");
    expect(out.id_token).toBe("***REDACTED***");
    expect(out.client_secret).toBe("***REDACTED***");
    expect(out.api_key).toBe("***REDACTED***");
    expect(out.api_secret).toBe("***REDACTED***");
    expect(out.password).toBe("***REDACTED***");
    expect(out.authorization).toBe("***REDACTED***");
    expect(out.cookie).toBe("***REDACTED***");
    expect(JSON.stringify(out)).not.toContain("token123");
    expect(JSON.stringify(out)).not.toContain("refresh456");
    expect(JSON.stringify(out)).not.toContain("secret123");
    expect(JSON.stringify(out)).not.toContain("pass123");
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

