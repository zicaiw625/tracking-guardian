/**
 * Prisma Mock
 *
 * Mock implementation of Prisma client for testing.
 */

import { vi, type Mock } from "vitest";
import type { PrismaClient } from "@prisma/client";

// =============================================================================
// Types
// =============================================================================

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

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a mock model with all common Prisma methods
 */
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

/**
 * Create a full mock Prisma client
 */
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
    $transaction: vi.fn((fn) => fn(createMockPrismaClient())),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
}

// =============================================================================
// Test Data Factories
// =============================================================================

/**
 * Create a mock shop
 */
export function createMockShop(overrides: Partial<MockShop> = {}): MockShop {
  return {
    id: "shop_123",
    shopDomain: "test-shop.myshopify.com",
    plan: "free",
    monthlyOrderLimit: 100,
    piiEnabled: false,
    consentStrategy: "strict",
    dataRetentionDays: 90,
    isActive: true,
    primaryDomain: null,
    storefrontDomains: [],
    ingestionSecretEncrypted: "encrypted_secret",
    webPixelId: null,
    shopTier: "non_plus",
    typOspPagesEnabled: false,
    pcdAcknowledged: false,
    pcdAcknowledgedAt: null,
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
  piiEnabled: boolean;
  consentStrategy: string | null;
  dataRetentionDays: number;
  isActive: boolean;
  primaryDomain: string | null;
  storefrontDomains: string[];
  ingestionSecretEncrypted: string | null;
  webPixelId: string | null;
  shopTier: string | null;
  typOspPagesEnabled: boolean | null;
  pcdAcknowledged: boolean;
  pcdAcknowledgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create a mock pixel config
 */
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

/**
 * Create a mock conversion job
 */
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

/**
 * Create a mock pixel event receipt
 */
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

// =============================================================================
// Setup Helpers
// =============================================================================

/**
 * Setup mock Prisma client with default returns
 */
export function setupMockPrisma(mockPrisma: MockPrismaClient): void {
  // Default shop not found
  mockPrisma.shop.findUnique.mockResolvedValue(null);
  mockPrisma.shop.findFirst.mockResolvedValue(null);
  mockPrisma.shop.findMany.mockResolvedValue([]);
  mockPrisma.shop.count.mockResolvedValue(0);

  // Default config not found
  mockPrisma.pixelConfig.findUnique.mockResolvedValue(null);
  mockPrisma.pixelConfig.findFirst.mockResolvedValue(null);
  mockPrisma.pixelConfig.findMany.mockResolvedValue([]);
  mockPrisma.pixelConfig.count.mockResolvedValue(0);

  // Default job operations
  mockPrisma.conversionJob.findUnique.mockResolvedValue(null);
  mockPrisma.conversionJob.findFirst.mockResolvedValue(null);
  mockPrisma.conversionJob.findMany.mockResolvedValue([]);
  mockPrisma.conversionJob.count.mockResolvedValue(0);
  mockPrisma.conversionJob.updateMany.mockResolvedValue({ count: 0 });

  // Default receipt operations
  mockPrisma.pixelEventReceipt.findFirst.mockResolvedValue(null);
  mockPrisma.pixelEventReceipt.findMany.mockResolvedValue([]);

  // Default nonce operations (no duplicates)
  mockPrisma.eventNonce.findUnique.mockResolvedValue(null);
  mockPrisma.eventNonce.create.mockImplementation((args) =>
    Promise.resolve({ id: "nonce_123", ...args.data })
  );

  // Default monthly usage
  mockPrisma.monthlyUsage.findFirst.mockResolvedValue({
    id: "usage_123",
    shopId: "shop_123",
    month: new Date().toISOString().slice(0, 7),
    count: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/**
 * Reset all mocks
 */
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

// =============================================================================
// Global Mock Instance
// =============================================================================

let globalMockPrisma: MockPrismaClient | null = null;

/**
 * Get or create global mock Prisma client
 */
export function getMockPrisma(): MockPrismaClient {
  if (!globalMockPrisma) {
    globalMockPrisma = createMockPrismaClient();
    setupMockPrisma(globalMockPrisma);
  }
  return globalMockPrisma;
}

/**
 * Reset global mock Prisma client
 */
export function resetGlobalMockPrisma(): void {
  if (globalMockPrisma) {
    resetMockPrisma(globalMockPrisma);
    setupMockPrisma(globalMockPrisma);
  }
}

