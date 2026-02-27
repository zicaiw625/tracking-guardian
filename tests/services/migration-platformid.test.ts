import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => {
  const createMockModel = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  });

  return {
    shop: createMockModel(),
    pixelConfig: createMockModel(),
  };
});

const mocks = vi.hoisted(() => ({
  saveConfigSnapshot: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({ default: mockPrisma }));
vi.mock("../../app/services/pixel-rollback.server", () => ({
  saveConfigSnapshot: mocks.saveConfigSnapshot,
}));

import prisma from "../../app/db.server";
import { savePixelConfig } from "../../app/services/migration.server";

describe("savePixelConfig platformId normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses null branch for blank platformId and updates existing null/empty config", async () => {
    vi.mocked(prisma.pixelConfig.findFirst).mockResolvedValue({
      id: "cfg-null",
    } as any);
    vi.mocked(prisma.pixelConfig.update).mockResolvedValue({
      id: "cfg-null",
    } as any);

    await savePixelConfig("shop-1", "meta", "   ", { environment: "live" });

    expect(prisma.pixelConfig.findFirst).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        platform: "meta",
        environment: "live",
        OR: [{ platformId: null }, { platformId: "" }],
      },
    });
    expect(prisma.pixelConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cfg-null" },
        data: expect.objectContaining({
          platformId: null,
        }),
      })
    );
    expect(prisma.pixelConfig.upsert).not.toHaveBeenCalled();
    expect(mocks.saveConfigSnapshot).toHaveBeenCalled();
  });

  it("uses trimmed non-empty platformId in composite upsert key", async () => {
    vi.mocked(prisma.pixelConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.pixelConfig.upsert).mockResolvedValue({
      id: "cfg-1",
    } as any);

    await savePixelConfig("shop-1", "meta", " pixel_123 ", { environment: "test" });

    expect(prisma.pixelConfig.findUnique).toHaveBeenCalledWith({
      where: {
        shopId_platform_environment_platformId: {
          shopId: "shop-1",
          platform: "meta",
          environment: "test",
          platformId: "pixel_123",
        },
      },
    });
    expect(prisma.pixelConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shopId_platform_environment_platformId: {
            shopId: "shop-1",
            platform: "meta",
            environment: "test",
            platformId: "pixel_123",
          },
        },
        update: expect.objectContaining({
          platformId: "pixel_123",
        }),
        create: expect.objectContaining({
          platformId: "pixel_123",
        }),
      })
    );
  });

  it("does not force-disable serverSideEnabled when option is omitted", async () => {
    vi.mocked(prisma.pixelConfig.findUnique).mockResolvedValue({
      id: "cfg-keep",
      serverSideEnabled: true,
    } as any);
    vi.mocked(prisma.pixelConfig.upsert).mockResolvedValue({ id: "cfg-keep" } as any);

    await savePixelConfig("shop-1", "meta", "pixel_456", { environment: "live" });

    expect(prisma.pixelConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          serverSideEnabled: undefined,
        }),
      })
    );
  });
});
