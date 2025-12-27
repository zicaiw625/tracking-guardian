

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

export {

  createMetaSuccessResponse,
  createMetaErrorResponse,
  createGoogleSuccessResponse,
  createGoogleErrorResponse,
  createTikTokSuccessResponse,
  createTikTokErrorResponse,

  createMetaApiHandler,
  createGoogleApiHandler,
  createTikTokApiHandler,
  createCombinedPlatformHandler,

  setupFetchMock,
  restoreFetch,
  getMockFetch,

  createRateLimitHandler,
  createTimeoutHandler,
  createNetworkErrorHandler,

  assertMetaCapiCalled,
  assertGoogleAnalyticsCalled,
  assertTikTokEventsCalled,
  type MockPlatformResponse,
  type MockFetchHandler,
} from "./platforms.mock";

export {

  createMockSession,
  createMockGraphQLResponse,
  createMockAdminApi,
  createMockAdminContext,
  createMockWebhookContext,

  createMockOrderPayload,

  createMockGDPRDataRequestPayload,
  createMockGDPRCustomerRedactPayload,
  createMockGDPRShopRedactPayload,

  createMockShopQueryResponse,
  createMockWebhookSubscriptionResponse,
  createMockWebPixelCreateResponse,

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

