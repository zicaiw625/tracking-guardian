import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  pixelConfig: {
    findMany: vi.fn(),
  },
}));

vi.mock("../../../app/db.server", () => ({
  default: mockPrisma,
}));

import { checkPixelDestinationsLimit } from "../../../app/services/billing/feature-gates.server";

describe("feature-gates pixel destination limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts active unique platforms instead of server-side configs", async () => {
    vi.mocked(mockPrisma.pixelConfig.findMany).mockResolvedValue([
      { platform: "google" },
      { platform: "google" },
      { platform: "meta" },
    ] as never);

    const result = await checkPixelDestinationsLimit("shop-1", "starter");

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(2);
    expect(result.limit).toBe(1);
  });

  it("allows updating an already configured platform at limit", async () => {
    vi.mocked(mockPrisma.pixelConfig.findMany).mockResolvedValue([
      { platform: "google" },
    ] as never);

    const result = await checkPixelDestinationsLimit("shop-1", "starter", "google");

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
    expect(result.limit).toBe(1);
  });
});
