/**
 * P0-2: Checkout Profile Service
 * 
 * This service queries the checkoutProfiles Admin API to determine if a shop
 * has upgraded to the new Thank you / Order status pages (TYP/OSP).
 * 
 * Background:
 * - The CHECKOUT_AND_ACCOUNTS_CONFIGURATIONS_UPDATE webhook will be removed on 2026-01-01
 * - We need a reliable API-based way to check upgrade status
 * - checkoutProfiles query is the official replacement
 * 
 * Usage:
 * - Call getTypOspActive() during scanner runs
 * - Call refreshTypOspStatus() in cron jobs every 6 hours
 * - The webhook handler (if still working) serves as a faster update path
 */

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { logger } from "../utils/logger";

export interface CheckoutProfileInfo {
  /** Whether the shop uses the new extensible checkout (TYP/OSP pages) */
  isExtensible: boolean;
  /** The checkout profile ID */
  profileId: string | null;
  /** Name of the checkout profile */
  name: string | null;
  /** Whether this is the default profile */
  isDefault: boolean;
  /** Whether checkout UI extensions are enabled */
  extensionsEnabled: boolean;
  /** Raw data for debugging */
  rawData?: unknown;
}

export interface TypOspStatusResult {
  /** Whether new TYP/OSP pages are active */
  typOspPagesEnabled: boolean;
  /** Confidence level of the result */
  confidence: "high" | "medium" | "low";
  /** When this was last checked */
  checkedAt: Date;
  /** Any error that occurred */
  error?: string;
  /** Additional context */
  profiles?: CheckoutProfileInfo[];
}

/**
 * Query the checkout profiles to determine if new TYP/OSP pages are active.
 * 
 * The new extensible checkout uses Checkout UI Extensions and Web Pixels
 * instead of Additional Scripts and ScriptTags.
 */
export async function getTypOspActive(admin: AdminApiContext): Promise<TypOspStatusResult> {
  try {
    // Query checkout profiles to understand the shop's checkout configuration
    // Note: The exact query structure may need adjustment based on API version
    const response = await admin.graphql(`
      #graphql
      query GetCheckoutProfiles {
        checkoutProfiles(first: 10) {
          edges {
            node {
              id
              name
              isPublished
            }
          }
        }
        shop {
          checkoutApiSupported
          features {
            storefront
          }
        }
      }
    `);

    const data = await response.json();
    
    if (data.errors) {
      logger.warn("P0-2: GraphQL errors in checkoutProfiles query:", data.errors);
      // If we get permission errors, the shop likely hasn't upgraded
      const isPermissionError = data.errors.some((e: { message?: string }) => 
        e.message?.includes("access") || e.message?.includes("permission")
      );
      
      if (isPermissionError) {
        return {
          typOspPagesEnabled: false,
          confidence: "low",
          checkedAt: new Date(),
          error: "Insufficient permissions to query checkout profiles",
        };
      }
    }

    const profiles = data.data?.checkoutProfiles?.edges || [];
    const shop = data.data?.shop;
    
    // Parse profile information
    const profileInfos: CheckoutProfileInfo[] = profiles.map((edge: { 
      node: { id: string; name: string; isPublished: boolean } 
    }) => ({
      profileId: edge.node.id,
      name: edge.node.name,
      isDefault: edge.node.isPublished === true,
      isExtensible: true, // If profiles exist, checkout is extensible
      extensionsEnabled: true,
    }));

    // Determine if TYP/OSP is enabled based on various signals
    const hasCheckoutProfiles = profiles.length > 0;
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    
    // If checkout profiles exist and API is supported, new pages are likely active
    const typOspPagesEnabled = hasCheckoutProfiles && checkoutApiSupported;
    
    return {
      typOspPagesEnabled,
      confidence: hasCheckoutProfiles ? "high" : "medium",
      checkedAt: new Date(),
      profiles: profileInfos,
    };
  } catch (error) {
    logger.error("P0-2: Failed to query checkout profiles:", error);
    
    return {
      typOspPagesEnabled: false,
      confidence: "low",
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Alternative query using shop features - works even without checkout_profiles scope
 */
export async function getTypOspStatusFromShopFeatures(admin: AdminApiContext): Promise<TypOspStatusResult> {
  try {
    const response = await admin.graphql(`
      #graphql
      query GetShopCheckoutFeatures {
        shop {
          checkoutApiSupported
          features {
            storefront
          }
          plan {
            displayName
            partnerDevelopment
            shopifyPlus
          }
        }
      }
    `);

    const data = await response.json();
    
    if (data.errors) {
      logger.warn("P0-2: GraphQL errors in shop features query:", data.errors);
    }

    const shop = data.data?.shop;
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    const isPlus = shop?.plan?.shopifyPlus === true;
    
    // checkoutApiSupported being true is a strong signal that extensible checkout is available
    // For Plus shops, this usually means they're on the new checkout
    
    return {
      typOspPagesEnabled: checkoutApiSupported,
      confidence: isPlus && checkoutApiSupported ? "high" : "medium",
      checkedAt: new Date(),
    };
  } catch (error) {
    logger.error("P0-2: Failed to query shop features:", error);
    
    return {
      typOspPagesEnabled: false,
      confidence: "low",
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Refresh and persist TYP/OSP status for a shop.
 * Call this from cron jobs and scanner.
 */
export async function refreshTypOspStatus(
  admin: AdminApiContext,
  shopId: string
): Promise<TypOspStatusResult> {
  // Try the full checkoutProfiles query first
  let result = await getTypOspActive(admin);
  
  // If that failed with low confidence, try the simpler shop features query
  if (result.confidence === "low" && result.error) {
    logger.info("P0-2: Falling back to shop features query");
    result = await getTypOspStatusFromShopFeatures(admin);
  }
  
  // Persist the result to the database
  try {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        typOspPagesEnabled: result.typOspPagesEnabled,
        typOspUpdatedAt: result.checkedAt,
      },
    });
    
    logger.info(`P0-2: Updated typOspPagesEnabled=${result.typOspPagesEnabled} for shop ${shopId}`, {
      confidence: result.confidence,
    });
  } catch (dbError) {
    logger.error("P0-2: Failed to persist TYP/OSP status:", dbError);
  }
  
  return result;
}

/**
 * Get cached TYP/OSP status from database, with staleness check.
 * Returns null if status is unknown or too stale.
 */
export async function getCachedTypOspStatus(shopId: string): Promise<{
  typOspPagesEnabled: boolean | null;
  isStale: boolean;
  lastUpdated: Date | null;
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      typOspPagesEnabled: true,
      typOspUpdatedAt: true,
    },
  });
  
  if (!shop) {
    return {
      typOspPagesEnabled: null,
      isStale: true,
      lastUpdated: null,
    };
  }
  
  // Consider data stale if older than 24 hours
  const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
  const isStale = !shop.typOspUpdatedAt || 
    (Date.now() - shop.typOspUpdatedAt.getTime()) > staleThreshold;
  
  return {
    typOspPagesEnabled: shop.typOspPagesEnabled,
    isStale,
    lastUpdated: shop.typOspUpdatedAt,
  };
}

