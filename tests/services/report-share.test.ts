import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
  },
  scanReport: {
    findFirst: vi.fn(),
  },
  reportShareLink: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
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
import {
  createScanReportShareLink,
  resolvePublicScanReportByToken,
  resolvePublicVerificationReportByToken,
  revokeScanReportShareLinks,
} from "../../app/services/report-share.server";

describe("report share permission consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when current shop plan does not support report export", async () => {
    vi.mocked(prisma.reportShareLink.findUnique).mockResolvedValue({
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
    expect(prisma.reportShareLink.updateMany).not.toHaveBeenCalled();
  });

  it("returns report data when plan supports export", async () => {
    vi.mocked(prisma.reportShareLink.findUnique).mockResolvedValue({
      id: "share-1",
      shopId: "shop-1",
      runId: "run-1",
      tokenPrefix: "abc",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "verification_report",
      maxAccessCount: 20,
      accessCount: 0,
    });
    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      plan: "growth",
    } as never);
    vi.mocked(prisma.reportShareLink.updateMany).mockResolvedValue({ count: 1 } as never);
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
    expect(prisma.reportShareLink.updateMany).toHaveBeenCalled();
  });

  it("creates a scan report share link", async () => {
    vi.mocked(prisma.scanReport.findFirst).mockResolvedValue({
      id: "scan-1",
    } as never);
    vi.mocked(prisma.reportShareLink.create).mockResolvedValue({
      id: "share-scan-1",
      tokenPrefix: "prefix01",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as never);

    const result = await createScanReportShareLink({
      shopId: "shop-1",
      reportId: "scan-1",
      createdBy: "session-1",
      expiresInDays: 7,
    });

    expect(result.id).toBe("share-scan-1");
    expect(result.tokenPrefix).toBe("prefix01");
    expect(result.maxAccessCount).toBe(20);
    expect(result.token.length).toBeGreaterThan(0);
    expect(prisma.reportShareLink.create).toHaveBeenCalled();
  });

  it("revokes scan report share links", async () => {
    vi.mocked(prisma.reportShareLink.updateMany).mockResolvedValue({
      count: 2,
    } as never);

    const count = await revokeScanReportShareLinks("shop-1", "scan-1");
    expect(count).toBe(2);
    expect(prisma.reportShareLink.updateMany).toHaveBeenCalled();
  });

  it("resolves public scan report by token", async () => {
    vi.mocked(prisma.reportShareLink.findUnique).mockResolvedValue({
      id: "share-scan-1",
      shopId: "shop-1",
      scanReportId: "scan-1",
      tokenPrefix: "prefix01",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "scan_report",
      maxAccessCount: 20,
      accessCount: 0,
    } as never);
    vi.mocked(prisma.reportShareLink.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.scanReport.findFirst).mockResolvedValue({
      id: "scan-1",
      riskScore: 42,
      status: "completed",
      identifiedPlatforms: ["meta", "ga4"],
      riskItems: [
        {
          id: "risk-1",
          name: "Deprecated script",
          severity: "high",
        },
      ],
      createdAt: new Date(),
      completedAt: new Date(),
    } as never);

    const result = await resolvePublicScanReportByToken("token-1");

    expect(result).not.toBeNull();
    expect(result?.reportId).toBe("scan-1");
    expect(result?.riskItems.length).toBe(1);
    expect(prisma.reportShareLink.updateMany).toHaveBeenCalled();
  });

  it("blocks verification share when access limit is reached", async () => {
    vi.mocked(prisma.reportShareLink.findUnique).mockResolvedValue({
      id: "share-1",
      shopId: "shop-1",
      runId: "run-1",
      tokenPrefix: "abc",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "verification_report",
      maxAccessCount: 1,
      accessCount: 1,
    } as never);

    const result = await resolvePublicVerificationReportByToken("token-limit");
    expect(result).toBeNull();
    expect(prisma.reportShareLink.updateMany).not.toHaveBeenCalled();
  });

  it("blocks scan share when atomic increment is rejected", async () => {
    vi.mocked(prisma.reportShareLink.findUnique).mockResolvedValue({
      id: "share-scan-1",
      shopId: "shop-1",
      scanReportId: "scan-1",
      tokenPrefix: "prefix01",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      scope: "scan_report",
      maxAccessCount: 20,
      accessCount: 0,
    } as never);
    vi.mocked(prisma.reportShareLink.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await resolvePublicScanReportByToken("token-race");
    expect(result).toBeNull();
  });
});
