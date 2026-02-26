import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("shopify config for order webhook truth source", () => {
  it("includes read_orders in shopify.app.toml scopes", () => {
    const file = readFileSync(resolve(process.cwd(), "shopify.app.toml"), "utf8");
    expect(file).toMatch(/scopes\s*=\s*".*read_orders.*"/);
  });

  it("registers orders/create and orders/paid webhook subscriptions", () => {
    const file = readFileSync(resolve(process.cwd(), "shopify.app.toml"), "utf8");
    expect(file).toContain("topics = [\"orders/create\", \"orders/paid\"]");
  });

  it("registers ORDERS_CREATE and ORDERS_PAID in app config", () => {
    const file = readFileSync(
      resolve(process.cwd(), "app/services/shopify/app-config.server.ts"),
      "utf8"
    );
    expect(file).toContain("ORDERS_CREATE");
    expect(file).toContain("ORDERS_PAID");
  });
});
