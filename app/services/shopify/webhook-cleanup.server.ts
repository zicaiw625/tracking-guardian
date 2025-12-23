/**
 * Webhook Cleanup Service
 *
 * Handles cleanup of deprecated webhook subscriptions.
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../../utils/logger.server";
import type {
  WebhookSubscriptionsQueryResponse,
  WebhookDeleteMutationResponse,
} from "../../types/shopify";

// =============================================================================
// Constants
// =============================================================================

/**
 * Deprecated webhook topics that should be cleaned up
 */
const DEPRECATED_TOPICS = new Set<string>([
  "CHECKOUT_AND_ACCOUNTS_CONFIGURATIONS_UPDATE",
]);

/**
 * Maximum pages to process during cleanup
 */
const MAX_CLEANUP_PAGES = 10;

// =============================================================================
// Type Guards
// =============================================================================

interface DeprecatedSubscription {
  id: string;
  topic: string;
}

// =============================================================================
// Functions
// =============================================================================

/**
 * Fetch all deprecated webhook subscriptions
 */
async function fetchDeprecatedSubscriptions(
  admin: AdminApiContext,
  shopDomain: string
): Promise<DeprecatedSubscription[]> {
  const deprecatedSubs: DeprecatedSubscription[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage && pages < MAX_CLEANUP_PAGES) {
    const response = await admin.graphql(
      `
      query GetWebhookSubscriptions($cursor: String) {
        webhookSubscriptions(first: 250, after: $cursor) {
          edges {
            node {
              id
              topic
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
      { variables: { cursor } }
    );

    const data = (await response.json()) as WebhookSubscriptionsQueryResponse;

    if (data.errors) {
      logger.warn(
        `[Webhooks] Failed to query subscriptions for ${shopDomain}`,
        { errors: data.errors }
      );
      return [];
    }

    const edges = data.data?.webhookSubscriptions?.edges ?? [];
    for (const edge of edges) {
      if (DEPRECATED_TOPICS.has(edge.node.topic)) {
        deprecatedSubs.push({ id: edge.node.id, topic: edge.node.topic });
      }
    }

    const pageInfo = data.data?.webhookSubscriptions?.pageInfo;
    hasNextPage = pageInfo?.hasNextPage === true;
    cursor = pageInfo?.endCursor ?? null;
    pages++;
  }

  if (pages >= MAX_CLEANUP_PAGES && hasNextPage) {
    logger.warn(
      `[Webhooks] Pagination limit reached while querying webhook subscriptions for ${shopDomain}`,
      { pagesProcessed: pages }
    );
  }

  return deprecatedSubs;
}

/**
 * Delete a single webhook subscription
 */
async function deleteSubscription(
  admin: AdminApiContext,
  shopDomain: string,
  sub: DeprecatedSubscription
): Promise<boolean> {
  try {
    const deleteResponse = await admin.graphql(
      `
      mutation DeleteWebhookSubscription($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors {
            field
            message
          }
        }
      }
    `,
      { variables: { id: sub.id } }
    );

    const deleteData =
      (await deleteResponse.json()) as WebhookDeleteMutationResponse;
    const userErrors =
      deleteData.data?.webhookSubscriptionDelete?.userErrors ?? [];

    if (userErrors.length > 0) {
      logger.warn(
        `[Webhooks] Error deleting ${sub.topic} for ${shopDomain}`,
        { userErrors }
      );
      return false;
    }

    logger.info(`[Webhooks] Deleted deprecated webhook for ${shopDomain}`, {
      topic: sub.topic,
    });
    return true;
  } catch (deleteError) {
    logger.warn(`[Webhooks] Failed to delete webhook for ${shopDomain}`, {
      topic: sub.topic,
      error:
        deleteError instanceof Error ? deleteError.message : String(deleteError),
    });
    return false;
  }
}

/**
 * Clean up deprecated webhook subscriptions for a shop.
 *
 * This function:
 * 1. Queries all webhook subscriptions for the shop
 * 2. Identifies subscriptions for deprecated topics
 * 3. Deletes each deprecated subscription
 */
export async function cleanupDeprecatedWebhookSubscriptions(
  admin: AdminApiContext,
  shopDomain: string
): Promise<void> {
  try {
    const deprecatedSubs = await fetchDeprecatedSubscriptions(admin, shopDomain);

    if (deprecatedSubs.length === 0) {
      return;
    }

    logger.info(
      `[Webhooks] Found deprecated webhooks for ${shopDomain}, cleaning up`,
      { count: deprecatedSubs.length }
    );

    for (const sub of deprecatedSubs) {
      await deleteSubscription(admin, shopDomain, sub);
    }
  } catch (error) {
    logger.warn(`[Webhooks] Cleanup query failed for ${shopDomain}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

