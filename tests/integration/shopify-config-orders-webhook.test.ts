import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("shopify config without order webhooks", () => {
  it("uses only the expected non-order scopes in shopify.app.toml", () => {
    const file = readFileSync(resolve(process.cwd(), "shopify.app.toml"), "utf8");
    expect(file).toContain(
      'scopes = "read_script_tags,read_pixels,write_pixels,read_customer_events"'
    );
  });

  it("does not register orders/create and orders/paid webhook subscriptions", () => {
    const file = readFileSync(resolve(process.cwd(), "shopify.app.toml"), "utf8");
    expect(file).not.toContain("topics = [\"orders/create\", \"orders/paid\"]");
  });

  it("does not register ORDERS_CREATE and ORDERS_PAID in app config", () => {
    const file = readFileSync(
      resolve(process.cwd(), "app/services/shopify/app-config.server.ts"),
      "utf8"
    );
    expect(file).not.toContain("ORDERS_CREATE");
    expect(file).not.toContain("ORDERS_PAID");
  });
});
