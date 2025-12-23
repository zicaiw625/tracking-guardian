/**
 * Test Mocks Index
 *
 * Centralized exports for all test mocks.
 */

// =============================================================================
// Prisma Mocks
// =============================================================================

export {
  createMockModel,
  createMockPrismaClient,
  createMockShop,
  createMockPixelConfig,
  createMockConversionJob,
  createMockPixelEventReceipt,
  setupMockPrisma,
  resetMockPrisma,
  getMockPrisma,
  resetGlobalMockPrisma,
  type MockPrismaClient,
  type MockModel,
  type MockShop,
  type MockPixelConfig,
  type MockConversionJob,
  type MockPixelEventReceipt,
} from "./prisma.mock";

// =============================================================================
// Platform API Mocks
// =============================================================================

export {
  // Response factories
  createMetaSuccessResponse,
  createMetaErrorResponse,
  createGoogleSuccessResponse,
  createGoogleErrorResponse,
  createTikTokSuccessResponse,
  createTikTokErrorResponse,
  // API handlers
  createMetaApiHandler,
  createGoogleApiHandler,
  createTikTokApiHandler,
  createCombinedPlatformHandler,
  // Fetch mock setup
  setupFetchMock,
  restoreFetch,
  getMockFetch,
  // Error simulation
  createRateLimitHandler,
  createTimeoutHandler,
  createNetworkErrorHandler,
  // Assertion helpers
  assertMetaCapiCalled,
  assertGoogleAnalyticsCalled,
  assertTikTokEventsCalled,
  type MockPlatformResponse,
  type MockFetchHandler,
} from "./platforms.mock";

// =============================================================================
// Shopify Mocks
// =============================================================================

export {
  // Factory functions
  createMockSession,
  createMockGraphQLResponse,
  createMockAdminApi,
  createMockAdminContext,
  createMockWebhookContext,
  // Order payloads
  createMockOrderPayload,
  // GDPR payloads
  createMockGDPRDataRequestPayload,
  createMockGDPRCustomerRedactPayload,
  createMockGDPRShopRedactPayload,
  // GraphQL responses
  createMockShopQueryResponse,
  createMockWebhookSubscriptionResponse,
  createMockWebPixelCreateResponse,
  // Authentication
  createMockAuthenticate,
  getMockAuthenticate,
  resetMockAuthenticate,
  type MockSession,
  type MockAdminContext,
  type MockAdminApi,
  type MockRestApi,
  type MockWebhookContext,
  type MockOrderPayload,
  type MockAddress,
  type MockLineItem,
} from "./shopify.mock";

