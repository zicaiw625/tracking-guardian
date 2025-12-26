/**
 * Admin Client Factory
 *
 * Creates GraphQL admin clients for making API calls on behalf of shops.
 * 
 * P1-1: Enhanced with:
 * - Automatic retry with exponential backoff
 * - 429/Retry-After handling
 * - Request cost and throttle status logging
 * - Structured error handling
 */

import { ApiVersion, type AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../../db.server";
import { decryptAccessToken } from "../../utils/token-encryption";
import { logger, createTimer } from "../../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

interface GraphQLClientResponse {
  json: () => Promise<unknown>;
  status: number;
  headers: Headers;
}

interface GraphQLClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> }
  ): Promise<GraphQLClientResponse>;
}

/**
 * P1-1: GraphQL response with extensions for cost tracking
 */
interface ShopifyGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      [key: string]: unknown;
    };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/**
 * P1-1: Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * P1-1: GraphQL request options
 */
interface GraphQLRequestOptions {
  variables?: Record<string, unknown>;
  operationName?: string;
  retryConfig?: Partial<RetryConfig>;
}

/**
 * P1-1: GraphQL request result with metadata
 */
interface GraphQLResult<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  cost?: {
    requested: number;
    actual: number;
    available: number;
    maximum: number;
    restoreRate: number;
  };
  retries: number;
  duration: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Error codes that should trigger a retry
 */
const RETRYABLE_ERROR_CODES = new Set([
  "THROTTLED",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
]);

/**
 * HTTP status codes that should trigger a retry
 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * P1-1: Calculate delay for retry with exponential backoff and jitter
 */
function calculateRetryDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterHeader?: string | null
): number {
  // If Retry-After header is present, use it
  if (retryAfterHeader) {
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(retryAfterSeconds)) {
      return retryAfterSeconds * 1000;
    }
  }

  // Exponential backoff with jitter
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
  const jitter = cappedDelay * 0.1 * Math.random();
  
  return Math.floor(cappedDelay + jitter);
}

/**
 * P1-1: Check if error is retryable
 */
function isRetryableError(
  statusCode: number,
  errors?: ShopifyGraphQLResponse["errors"]
): boolean {
  // Check HTTP status code
  if (RETRYABLE_STATUS_CODES.has(statusCode)) {
    return true;
  }

  // Check GraphQL error codes
  if (errors) {
    return errors.some((error) => {
      const code = error.extensions?.code;
      return typeof code === "string" && RETRYABLE_ERROR_CODES.has(code);
    });
  }

  return false;
}

/**
 * P1-1: Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Enhanced GraphQL Client
// =============================================================================

/**
 * P1-1: Create an enhanced GraphQL client with retry and rate limit handling
 */
function createEnhancedGraphQLClient(
  shopDomain: string,
  accessToken: string,
  apiVersion: ApiVersion = ApiVersion.July25
): GraphQLClient {
  const apiUrl = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  return {
    async graphql(
      query: string,
      options?: GraphQLRequestOptions
    ): Promise<GraphQLClientResponse> {
      const config = { ...DEFAULT_RETRY_CONFIG, ...options?.retryConfig };
      const timer = createTimer();
      let lastError: Error | null = null;
      let lastResponse: Response | null = null;

      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({
              query,
              variables: options?.variables,
              operationName: options?.operationName,
            }),
          });

          lastResponse = response;

          // Parse response to check for GraphQL errors
          const jsonResponse = await response.clone().json() as ShopifyGraphQLResponse;

          // Log cost and throttle status if available
          if (jsonResponse.extensions?.cost) {
            const cost = jsonResponse.extensions.cost;
            logger.debug("[GraphQL] Request cost", {
              shopDomain,
              operationName: options?.operationName,
              requestedCost: cost.requestedQueryCost,
              actualCost: cost.actualQueryCost,
              available: cost.throttleStatus.currentlyAvailable,
              maximum: cost.throttleStatus.maximumAvailable,
              restoreRate: cost.throttleStatus.restoreRate,
              attempt: attempt + 1,
              duration: timer.elapsed(),
            });

            // Warn if we're running low on available cost
            const availablePercent = 
              (cost.throttleStatus.currentlyAvailable / cost.throttleStatus.maximumAvailable) * 100;
            
            if (availablePercent < 20) {
              logger.warn("[GraphQL] Low API budget", {
                shopDomain,
                availablePercent: Math.round(availablePercent),
                available: cost.throttleStatus.currentlyAvailable,
                maximum: cost.throttleStatus.maximumAvailable,
              });
            }
          }

          // Check if we should retry
          if (isRetryableError(response.status, jsonResponse.errors)) {
            if (attempt < config.maxRetries) {
              const retryAfter = response.headers.get("Retry-After");
              const delay = calculateRetryDelay(attempt, config, retryAfter);

              logger.warn("[GraphQL] Retryable error, scheduling retry", {
                shopDomain,
                operationName: options?.operationName,
                status: response.status,
                attempt: attempt + 1,
                maxRetries: config.maxRetries,
                retryAfterMs: delay,
                errors: jsonResponse.errors?.map((e) => e.message).slice(0, 3),
              });

              await sleep(delay);
              continue;
            }
          }

          // Log successful request
          if (response.ok && !jsonResponse.errors) {
            logger.debug("[GraphQL] Request succeeded", {
              shopDomain,
              operationName: options?.operationName,
              attempt: attempt + 1,
              duration: timer.elapsed(),
            });
          } else if (jsonResponse.errors) {
            // Log non-retryable GraphQL errors
            logger.warn("[GraphQL] Request completed with errors", {
              shopDomain,
              operationName: options?.operationName,
              status: response.status,
              errors: jsonResponse.errors.map((e) => ({
                message: e.message,
                code: e.extensions?.code,
              })),
              attempt: attempt + 1,
              duration: timer.elapsed(),
            });
          }

          // Return response wrapper that preserves headers and status
          return {
            json: async () => jsonResponse,
            status: response.status,
            headers: response.headers,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Network errors are retryable
          if (attempt < config.maxRetries) {
            const delay = calculateRetryDelay(attempt, config, null);

            logger.warn("[GraphQL] Network error, scheduling retry", {
              shopDomain,
              operationName: options?.operationName,
              error: lastError.message,
              attempt: attempt + 1,
              maxRetries: config.maxRetries,
              retryAfterMs: delay,
            });

            await sleep(delay);
            continue;
          }
        }
      }

      // All retries exhausted
      logger.error("[GraphQL] All retries exhausted", lastError, {
        shopDomain,
        operationName: options?.operationName,
        totalAttempts: config.maxRetries + 1,
        duration: timer.elapsed(),
      });

      // Return last response if available, otherwise throw
      if (lastResponse) {
        return {
          json: async () => lastResponse!.json(),
          status: lastResponse.status,
          headers: lastResponse.headers,
        };
      }

      throw lastError || new Error("GraphQL request failed after all retries");
    },
  };
}

// =============================================================================
// Token Retrieval (unchanged)
// =============================================================================

/**
 * Try to get access token from offline session
 */
async function getAccessTokenFromSession(
  shopDomain: string
): Promise<string | null> {
  const offlineSession = await prisma.session.findFirst({
    where: {
      shop: shopDomain,
      isOnline: false,
      accessToken: { not: "" },
    },
    orderBy: { id: "desc" },
  });

  if (offlineSession?.accessToken) {
    try {
      const accessToken = decryptAccessToken(offlineSession.accessToken);
      if (accessToken) {
        return accessToken;
      }
    } catch (error) {
      logger.warn(
        `[Admin] Failed to decrypt offline session token for ${shopDomain}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  return null;
}

/**
 * Try to get access token from shop record
 */
async function getAccessTokenFromShop(
  shopDomain: string
): Promise<string | null> {
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { accessToken: true },
  });

  if (shopRecord?.accessToken) {
    try {
      return decryptAccessToken(shopRecord.accessToken);
    } catch {
      logger.warn(
        `[Admin] Failed to decrypt shop-level token for ${shopDomain}`
      );
    }
  }

  return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create an Admin API client for a shop.
 *
 * P1-1: Now uses enhanced client with:
 * - Automatic retry with exponential backoff
 * - 429/Retry-After handling
 * - Request cost tracking
 *
 * @param shopDomain - The shop's myshopify domain
 * @returns AdminApiContext or null if no valid token is available
 */
export async function createAdminClientForShop(
  shopDomain: string
): Promise<AdminApiContext | null> {
  try {
    // Try offline session first
    let accessToken = await getAccessTokenFromSession(shopDomain);

    // Fall back to shop record
    if (!accessToken) {
      accessToken = await getAccessTokenFromShop(shopDomain);
    }

    if (!accessToken) {
      logger.info(`[Admin] No usable offline token for ${shopDomain}`);
      return null;
    }

    // Create and return enhanced client
    const graphqlClient = createEnhancedGraphQLClient(shopDomain, accessToken);
    return graphqlClient as unknown as AdminApiContext;
  } catch (error) {
    logger.error(`[Admin] Failed to create client for ${shopDomain}`, error);
    return null;
  }
}

/**
 * Validate if we have a working admin client for a shop
 */
export async function hasValidAdminClient(
  shopDomain: string
): Promise<boolean> {
  const client = await createAdminClientForShop(shopDomain);
  return client !== null;
}

/**
 * P1-1: Execute a GraphQL query with full result metadata
 * 
 * This is a convenience function that returns structured results
 * including cost information and retry count.
 */
export async function executeGraphQL<T = unknown>(
  shopDomain: string,
  query: string,
  options?: GraphQLRequestOptions
): Promise<GraphQLResult<T> | null> {
  const timer = createTimer();
  const client = await createAdminClientForShop(shopDomain);
  
  if (!client) {
    return null;
  }

  try {
    const response = await client.graphql(query, options as { variables?: Record<string, unknown> });
    const json = await response.json() as ShopifyGraphQLResponse<T>;

    const result: GraphQLResult<T> = {
      data: json.data,
      errors: json.errors,
      retries: 0, // The retry count is internal to the client
      duration: timer.elapsed(),
    };

    // Add cost information if available
    if (json.extensions?.cost) {
      const cost = json.extensions.cost;
      result.cost = {
        requested: cost.requestedQueryCost,
        actual: cost.actualQueryCost,
        available: cost.throttleStatus.currentlyAvailable,
        maximum: cost.throttleStatus.maximumAvailable,
        restoreRate: cost.throttleStatus.restoreRate,
      };
    }

    return result;
  } catch (error) {
    logger.error("[GraphQL] executeGraphQL failed", error, {
      shopDomain,
      operationName: options?.operationName,
      duration: timer.elapsed(),
    });
    return null;
  }
}
