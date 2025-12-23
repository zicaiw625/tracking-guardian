/**
 * Admin Client Factory
 *
 * Creates GraphQL admin clients for making API calls on behalf of shops.
 */

import { ApiVersion, type AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../../db.server";
import { decryptAccessToken } from "../../utils/token-encryption";
import { logger } from "../../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

interface GraphQLClientResponse {
  json: () => Promise<unknown>;
}

interface GraphQLClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> }
  ): Promise<GraphQLClientResponse>;
}

// =============================================================================
// Private Functions
// =============================================================================

/**
 * Create a simple GraphQL client for making API calls
 */
function createGraphQLClient(
  shopDomain: string,
  accessToken: string,
  apiVersion: ApiVersion = ApiVersion.July25
): GraphQLClient {
  const apiUrl = `https://${shopDomain}/admin/api/${apiVersion}/graphql.json`;

  return {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> }
    ): Promise<GraphQLClientResponse> {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables,
        }),
      });

      return {
        json: async () => response.json(),
      };
    },
  };
}

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
 * This function tries to get a valid access token from:
 * 1. Offline session storage
 * 2. Shop record
 *
 * Returns null if no valid token is found.
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

    // Create and return client
    const graphqlClient = createGraphQLClient(shopDomain, accessToken);
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

