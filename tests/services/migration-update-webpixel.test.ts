import { describe, expect, it, vi } from "vitest";
import { updateWebPixel } from "../../app/services/migration.server";

describe("updateWebPixel strict mode/environment", () => {
  it("returns missing_mode_or_environment when mode or environment is missing", async () => {
    const admin = {
      graphql: vi.fn(),
    } as any;

    const result = await updateWebPixel(
      admin,
      "gid://shopify/WebPixel/1",
      "ingestion-key",
      "shop.myshopify.com",
      undefined as any,
      undefined as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_mode_or_environment");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});
