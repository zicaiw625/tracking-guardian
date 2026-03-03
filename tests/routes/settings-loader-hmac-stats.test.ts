import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  shop: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  pixelEventReceipt: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("../../app/db.server", () => ({
  default: mockPrisma,
}));

vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

vi.mock("../../app/i18n.server", () => ({
  i18nServer: {
    getFixedT: vi.fn(),
  },
}));

vi.mock("../../app/services/retry.server", () => ({
  checkTokenExpirationIssues: vi.fn(),
}));

vi.mock("../../app/services/checkout-profile.server", () => ({
  getCachedTypOspStatus: vi.fn(),
  refreshTypOspStatus: vi.fn(),
}));

vi.mock("../../app/services/monitoring.server", () => ({
  getEventMonitoringStats: vi.fn(),
  getEventVolumeStats: vi.fn(),
}));

vi.mock("../../app/utils/logger.server", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../app/utils/config.server", () => ({
  PCD_CONFIG: { APPROVED: false },
  SERVER_SIDE_CONVERSIONS_ENABLED: true,
}));

import prisma from "../../app/db.server";
import { authenticate } from "../../app/shopify.server";
import { i18nServer } from "../../app/i18n.server";
import { checkTokenExpirationIssues } from "../../app/services/retry.server";
import {
  getCachedTypOspStatus,
  refreshTypOspStatus,
} from "../../app/services/checkout-profile.server";
import {
  getEventMonitoringStats,
  getEventVolumeStats,
} from "../../app/services/monitoring.server";
import { settingsLoader } from "../../app/routes/settings/loader.server";

describe("settings loader hmac stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns calculated hmac security stats from receipts", async () => {
    const now = new Date();
    const pendingExpiry = new Date(now.getTime() + 60 * 60 * 1000);

    vi.mocked(authenticate.admin).mockResolvedValue({
      session: { shop: "test.myshopify.com" },
      admin: { graphql: vi.fn() },
    } as never);
    vi.mocked(i18nServer.getFixedT).mockResolvedValue(
      ((key: string) => key) as never
    );
    vi.mocked(checkTokenExpirationIssues).mockResolvedValue({
      hasIssues: false,
      affectedPlatforms: [],
    });
    vi.mocked(getEventMonitoringStats).mockResolvedValue({ failureRate: 1.2 } as never);
    vi.mocked(getEventVolumeStats).mockResolvedValue({ changePercent: -15 } as never);
    vi.mocked(getCachedTypOspStatus).mockResolvedValue({
      isStale: false,
      typOspPagesEnabled: true,
      status: "enabled",
    } as never);
    vi.mocked(refreshTypOspStatus).mockResolvedValue({
      typOspPagesEnabled: true,
      status: "enabled",
    } as never);

    vi.mocked(prisma.shop.findUnique).mockResolvedValue({
      id: "shop-1",
      plan: "growth",
      ingestionSecret: "secret",
      previousIngestionSecret: "old-secret",
      previousSecretExpiry: pendingExpiry,
      pendingIngestionSecret: "new-secret",
      pendingSecretIssuedAt: now,
      pendingSecretExpiry: pendingExpiry,
      pendingSecretMatchCount: 2,
      consentStrategy: "strict",
      dataRetentionDays: 30,
      settings: {},
      pixelConfigs: [],
    } as never);

    vi.mocked(prisma.pixelEventReceipt.count)
      .mockResolvedValueOnce(3 as never)
      .mockResolvedValueOnce(2 as never);
    vi.mocked(prisma.pixelEventReceipt.findFirst)
      .mockResolvedValueOnce({ createdAt: now } as never)
      .mockResolvedValueOnce({ createdAt: now } as never);

    const response = (await settingsLoader({
      request: new Request("https://example.com/app/settings"),
    } as never)) as Response;

    const data = (await response.json()) as {
      hmacSecurityStats: {
        invalidSignatureCount: number;
        nullOriginRequestCount: number;
        suspiciousActivityCount: number;
        graceWindowActive: boolean;
        rotationCount: number;
      } | null;
    };

    expect(data.hmacSecurityStats).not.toBeNull();
    expect(data.hmacSecurityStats?.invalidSignatureCount).toBe(3);
    expect(data.hmacSecurityStats?.nullOriginRequestCount).toBe(2);
    expect(data.hmacSecurityStats?.suspiciousActivityCount).toBe(5);
    expect(data.hmacSecurityStats?.graceWindowActive).toBe(true);
    expect(data.hmacSecurityStats?.rotationCount).toBe(2);
  });
});
