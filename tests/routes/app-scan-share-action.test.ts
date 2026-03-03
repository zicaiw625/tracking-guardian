import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
  },
  scanReport: {
    findFirst: vi.fn(),
  },
}));

const mockCreateScanShare = vi.hoisted(() => vi.fn());
const mockRevokeScanShare = vi.hoisted(() => vi.fn());

vi.mock("../../app/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn().mockResolvedValue({
      session: { shop: "test-shop.myshopify.com", id: "session-1" },
      admin: {},
    }),
  },
}));

vi.mock("../../app/i18n.server", () => ({
  i18nServer: {
    getFixedT: vi.fn().mockResolvedValue((key: string) => key),
  },
}));

vi.mock("../../app/services/scanner.server", () => ({
  scanShopTracking: vi.fn(),
}));

vi.mock("../../app/services/audit-asset.server", () => ({
  createAuditAsset: vi.fn(),
  batchCreateAuditAssets: vi.fn(),
}));

vi.mock("../../app/services/migration-checklist.server", () => ({
  generateMigrationChecklist: vi.fn(),
}));

vi.mock("../../app/services/report-share.server", () => ({
  createScanReportShareLink: mockCreateScanShare,
  revokeScanReportShareLinks: mockRevokeScanShare,
}));

vi.mock("../../app/utils/config.server", () => ({
  getPublicAppDomain: vi.fn(() => "https://example.com"),
}));

import { action } from "../../app/routes/app.scan/action.server";

describe("app.scan share action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockPrisma.shop.findUnique).mockResolvedValue({ id: "shop-1" } as never);
  });

  it("create_share_link only queries completed scan report", async () => {
    vi.mocked(mockPrisma.scanReport.findFirst).mockResolvedValue({ id: "scan-1" } as never);
    vi.mocked(mockCreateScanShare).mockResolvedValue({
      token: "token-1",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const formData = new FormData();
    formData.append("_action", "create_share_link");
    const request = new Request("https://example.com/app/scan", { method: "POST", body: formData });

    const response = await action({ request } as any);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(mockCreateScanShare).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAccessCount: 20,
        expiresInDays: 3,
      })
    );
    expect(mockPrisma.scanReport.findFirst).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        completedAt: { not: null },
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
  });

  it("revoke_share_link only queries completed scan report", async () => {
    vi.mocked(mockPrisma.scanReport.findFirst).mockResolvedValue({ id: "scan-1" } as never);
    vi.mocked(mockRevokeScanShare).mockResolvedValue(1);

    const formData = new FormData();
    formData.append("_action", "revoke_share_link");
    const request = new Request("https://example.com/app/scan", { method: "POST", body: formData });

    const response = await action({ request } as any);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(mockPrisma.scanReport.findFirst).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        completedAt: { not: null },
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true },
    });
  });

  it("returns noReport when there is no completed scan report", async () => {
    vi.mocked(mockPrisma.scanReport.findFirst).mockResolvedValue(null as never);

    const formData = new FormData();
    formData.append("_action", "create_share_link");
    const request = new Request("https://example.com/app/scan", { method: "POST", body: formData });

    const response = await action({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error).toBe("scan.share.toast.noReport");
  });

  it("returns noReport on revoke when there is no completed scan report", async () => {
    vi.mocked(mockPrisma.scanReport.findFirst).mockResolvedValue(null as never);

    const formData = new FormData();
    formData.append("_action", "revoke_share_link");
    const request = new Request("https://example.com/app/scan", { method: "POST", body: formData });

    const response = await action({ request } as any);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.success).toBe(false);
    expect(data.error).toBe("scan.share.toast.noReport");
  });
});
