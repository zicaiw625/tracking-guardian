import { vi, type Mock } from "vitest";

export interface MockPrismaClient {
  shop: MockModel;
  pixelConfig: MockModel;
  conversionJob: MockModel;
  conversionLog: MockModel;
  pixelEventReceipt: MockModel;
  eventNonce: MockModel;
  alertConfig: MockModel;
  scanReport: MockModel;
  reconciliationReport: MockModel;
  auditLog: MockModel;
  monthlyUsage: MockModel;
  webhookLog: MockModel;
  session: MockModel;
  surveyResponse: MockModel;
  gDPRJob: MockModel;
  auditAsset: MockModel;
  verificationRun: MockModel;
  shopGroup: MockModel;
  pixelTemplate: MockModel;
  $transaction: Mock;
  $connect: Mock;
  $disconnect: Mock;
}

export interface MockModel {
  findUnique: Mock;
  findFirst: Mock;
  findMany: Mock;
  create: Mock;
  createMany: Mock;
  update: Mock;
  updateMany: Mock;
  upsert: Mock;
  delete: Mock;
  deleteMany: Mock;
  count: Mock;
  aggregate: Mock;
  groupBy: Mock;
}

export function createMockModel(): MockModel {
  return {
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
  };
}

export function createMockPrismaClient(): MockPrismaClient {
  return {
    shop: createMockModel(),
    pixelConfig: createMockModel(),
    conversionJob: createMockModel(),
    conversionLog: createMockModel(),
    pixelEventReceipt: createMockModel(),
    eventNonce: createMockModel(),
    alertConfig: createMockModel(),
    scanReport: createMockModel(),
    reconciliationReport: createMockModel(),
    auditLog: createMockModel(),
    monthlyUsage: createMockModel(),
    webhookLog: createMockModel(),
    session: createMockModel(),
    surveyResponse: createMockModel(),
    gDPRJob: createMockModel(),
    auditAsset: createMockModel(),
    verificationRun: createMockModel(),
    shopGroup: createMockModel(),
    pixelTemplate: createMockModel(),
    $transaction: vi.fn((fn) => fn(createMockPrismaClient())),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
}

export function createMockShop(overrides: Partial<MockShop> = {}): MockShop {
  return {
    id: "shop_123",
    shopDomain: "test-shop.myshopify.com",
    plan: "free",
    monthlyOrderLimit: 100,
    consentStrategy: "strict",
    dataRetentionDays: 90,
    isActive: true,
    primaryDomain: null,
    storefrontDomains: [],
    ingestionSecretEncrypted: "encrypted_secret",
    webPixelId: null,
    shopTier: "non_plus",
    typOspPagesEnabled: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

export interface MockShop {
  id: string;
  shopDomain: string;
  plan: string | null;
  monthlyOrderLimit: number;
  consentStrategy: string | null;
  dataRetentionDays: number;
  isActive: boolean;
  primaryDomain: string | null;
  storefrontDomains: string[];
  ingestionSecretEncrypted: string | null;
  webPixelId: string | null;
  shopTier: string | null;
  typOspPagesEnabled: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createMockPixelConfig(overrides: Partial<MockPixelConfig> = {}): MockPixelConfig {
  return {
    id: "config_123",
    shopId: "shop_123",
    platform: "meta",
    platformId: "123456789012345",
    clientConfig: null,
    credentialsEncrypted: "encrypted_creds",
    clientSideEnabled: true,
    serverSideEnabled: true,
    eventMappings: null,
    migrationStatus: "completed",
    migratedAt: new Date("2024-01-01"),
    isActive: true,
    lastVerifiedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

export interface MockPixelConfig {
  id: string;
  shopId: string;
  platform: string;
  platformId: string | null;
  clientConfig: unknown;
  credentialsEncrypted: string | null;
  clientSideEnabled: boolean;
  serverSideEnabled: boolean;
  eventMappings: unknown;
  migrationStatus: string;
  migratedAt: Date | null;
  isActive: boolean;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function createMockConversionJob(overrides: Partial<MockConversionJob> = {}): MockConversionJob {
  return {
    id: "job_123",
    shopId: "shop_123",
    orderId: "order_456",
    orderNumber: "1001",
    checkoutToken: "checkout_789",
    status: "queued",
    capiInput: {
      orderId: "order_456",
      value: 99.99,
      currency: "USD",
    },
    consentEvidence: null,
    trustMetadata: null,
    platformResults: null,
    attempts: 0,
    nextAttemptAt: new Date(),
    errorMessage: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    completedAt: null,
    ...overrides,
  };
}

export interface MockConversionJob {
  id: string;
  shopId: string;
  orderId: string;
  orderNumber: string | null;
  checkoutToken: string | null;
  status: string;
  capiInput: unknown;
  consentEvidence: unknown;
  trustMetadata: unknown;
  platformResults: unknown;
  attempts: number;
  nextAttemptAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export function createMockPixelEventReceipt(overrides: Partial<MockPixelEventReceipt> = {}): MockPixelEventReceipt {
  return {
    id: "receipt_123",
    shopId: "shop_123",
    checkoutToken: "checkout_789",
    orderId: null,
    eventType: "checkout_completed",
    eventId: "event_abc",
    matchKey: "match_xyz",
    trustLevel: "trusted",
    originValidated: true,
    signatureStatus: "key_matched",
    consentState: { marketing: true, analytics: true },
    receivedAt: new Date("2024-01-01"),
    expiresAt: new Date("2024-01-02"),
    ...overrides,
  };
}

export interface MockPixelEventReceipt {
  id: string;
  shopId: string;
  checkoutToken: string | null;
  orderId: string | null;
  eventType: string;
  eventId: string;
  matchKey: string | null;
  trustLevel: string;
  originValidated: boolean;
  signatureStatus: string;
  consentState: unknown;
  receivedAt: Date;
  expiresAt: Date;
}

export function setupMockPrisma(mockPrisma: MockPrismaClient): void {
  mockPrisma.shop.findUnique.mockResolvedValue(null);
  mockPrisma.shop.findFirst.mockResolvedValue(null);
  mockPrisma.shop.findMany.mockResolvedValue([]);
  mockPrisma.shop.count.mockResolvedValue(0);
  mockPrisma.pixelConfig.findUnique.mockResolvedValue(null);
  mockPrisma.pixelConfig.findFirst.mockResolvedValue(null);
  mockPrisma.pixelConfig.findMany.mockResolvedValue([]);
  mockPrisma.pixelConfig.count.mockResolvedValue(0);
  mockPrisma.conversionJob.findUnique.mockResolvedValue(null);
  mockPrisma.conversionJob.findFirst.mockResolvedValue(null);
  mockPrisma.conversionJob.findMany.mockResolvedValue([]);
  mockPrisma.conversionJob.count.mockResolvedValue(0);
  mockPrisma.conversionJob.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.pixelEventReceipt.findFirst.mockResolvedValue(null);
  mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);
  mockPrisma.eventNonce.findUnique.mockResolvedValue(null);
  mockPrisma.eventNonce.create.mockImplementation((args) =>
    Promise.resolve({ id: "nonce_123", ...args.data })
  );
  mockPrisma.monthlyUsage.findFirst.mockResolvedValue({
    id: "usage_123",
    shopId: "shop_123",
    month: new Date().toISOString().slice(0, 7),
    count: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export function resetMockPrisma(mockPrisma: MockPrismaClient): void {
  Object.values(mockPrisma).forEach((model) => {
    if (model && typeof model === "object") {
      Object.values(model).forEach((fn) => {
        if (typeof fn === "function" && "mockReset" in fn) {
          (fn as Mock).mockReset();
        }
      });
    }
  });
}

let globalMockPrisma: MockPrismaClient | null = null;

export function getMockPrisma(): MockPrismaClient {
  if (!globalMockPrisma) {
    globalMockPrisma = createMockPrismaClient();
    setupMockPrisma(globalMockPrisma);
  }
  return globalMockPrisma;
}

export function resetGlobalMockPrisma(): void {
  if (globalMockPrisma) {
    resetMockPrisma(globalMockPrisma);
    setupMockPrisma(globalMockPrisma);
  }
}
