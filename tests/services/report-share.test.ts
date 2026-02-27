import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
  },
  reportShareLink: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("../../app/services/verification-report.server", () => ({
  generateVerificationReportData: vi.fn(),
}));

vi.mock("../../app/utils/crypto.server", () => ({
  hashValueSync: vi.fn((v: string) => `hashed-${v}`),
}));

import prisma from "../../app/db.server";
import { generateVerificationReportData } from "../../app/services/verification-report.server";
import { resolvePublicVerificationReportByToken } from "../../app/services/report-share.server";

describe("report share permission consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when current shop plan does not support report export", async () => {
    vi.mocked((prisma as any).reportShareLink.findUnique).mockResolvedValue({
      id: "share-1",
      shopId: "shop-1",
      runId: "run-1",
      tokenPrefix: "abc",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "verification_report",
    });
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      plan: "starter",
    } as never);

    const result = await resolvePublicVerificationReportByToken("token-1");
    expect(result).toBeNull();
    expect((prisma as any).reportShareLink.update).not.toHaveBeenCalled();
  });

  it("returns report data when plan supports export", async () => {
    vi.mocked((prisma as any).reportShareLink.findUnique).mockResolvedValue({
      id: "share-1",
      shopId: "shop-1",
      runId: "run-1",
      tokenPrefix: "abc",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "verification_report",
    });
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      plan: "growth",
    } as never);
    vi.mocked((prisma as any).reportShareLink.update).mockResolvedValue({});
    vi.mocked(generateVerificationReportData).mockResolvedValue({
      runId: "run-1",
      runName: "Test",
      runType: "quick",
      status: "completed",
      platforms: ["meta"],
      summary: {
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        parameterCompleteness: 100,
        valueAccuracy: 100,
      },
      platformResults: {},
      events: [],
      createdAt: new Date(),
    } as any);

    const result = await resolvePublicVerificationReportByToken("token-1");
    expect(result).not.toBeNull();
    expect((prisma as any).reportShareLink.update).toHaveBeenCalled();
  });
});
