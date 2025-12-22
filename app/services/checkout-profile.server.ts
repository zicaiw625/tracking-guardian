import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { logger } from "../utils/logger";

export interface CheckoutProfileInfo {
  isExtensible: boolean;
  profileId: string | null;
  name: string | null;
  isPublished: boolean;
  typOspPagesActive: boolean | null;
  rawData?: unknown;
}

export type TypOspStatus = "enabled" | "disabled" | "unknown";

export type TypOspUnknownReason = 
  | "NOT_PLUS"
  | "NO_EDITOR_ACCESS"
  | "API_ERROR"
  | "RATE_LIMIT"
  | "NO_PROFILES"
  | "FIELD_NOT_AVAILABLE"
  | "NO_ADMIN_CONTEXT";

export interface TypOspStatusResult {
  status: TypOspStatus;
  typOspPagesEnabled: boolean | null;
  unknownReason?: TypOspUnknownReason;
  confidence: "high" | "medium" | "low";
  checkedAt: Date;
  error?: string;
  profiles?: CheckoutProfileInfo[];
}

export async function getTypOspActive(admin: AdminApiContext): Promise<TypOspStatusResult> {
  try {
    const response = await admin.graphql(`
      query GetCheckoutProfiles {
        checkoutProfiles(first: 10) {
          nodes {
            id
            name
            isPublished
            typOspPagesActive
          }
        }
        shop {
          checkoutApiSupported
          plan {
            shopifyPlus
          }
        }
      }
    `);

    const data = await response.json();
    
    if (data.errors) {
      logger.warn("GraphQL errors in checkoutProfiles query:", data.errors);
      
      const errorMessages = data.errors.map((e: { message?: string }) => e.message || "").join(" ");
      
      if (errorMessages.toLowerCase().includes("plus")) {
        return {
          status: "unknown",
          typOspPagesEnabled: null,
          unknownReason: "NOT_PLUS",
          confidence: "low",
          checkedAt: new Date(),
          error: errorMessages.substring(0, 200),
        };
      }

      if (errorMessages.includes("access") || errorMessages.includes("permission")) {
        return {
          status: "unknown",
          typOspPagesEnabled: null,
          unknownReason: "NO_EDITOR_ACCESS",
          confidence: "low",
          checkedAt: new Date(),
          error: "Requires access to checkout and accounts editor",
        };
      }
      
      if (errorMessages.includes("rate") || errorMessages.includes("throttle")) {
        return {
          status: "unknown",
          typOspPagesEnabled: null,
          unknownReason: "RATE_LIMIT",
          confidence: "low",
          checkedAt: new Date(),
          error: "Rate limited, try again later",
        };
      }
      
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "API_ERROR",
        confidence: "low",
        checkedAt: new Date(),
        error: errorMessages.substring(0, 200),
      };
    }

    const profiles = data.data?.checkoutProfiles?.nodes || [];
    const shop = data.data?.shop;
    const isPlus = shop?.plan?.shopifyPlus === true;
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    
    if (profiles.length === 0) {
      if (!isPlus) {
        return {
          status: "unknown",
          typOspPagesEnabled: null,
          unknownReason: "NOT_PLUS",
          confidence: "medium",
          checkedAt: new Date(),
          error: "Non-Plus shops may not have checkoutProfiles access",
        };
      }
      
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "NO_PROFILES",
        confidence: "low",
        checkedAt: new Date(),
        error: "No checkout profiles returned",
      };
    }
    
    const profileInfos: CheckoutProfileInfo[] = profiles.map((node: {
      id: string;
      name: string;
      isPublished: boolean;
      typOspPagesActive?: boolean;
    }) => {
      const isPublished = node.isPublished === true;
      const typOspPagesActive = node.typOspPagesActive ?? null;

      return {
        profileId: node.id,
        name: node.name,
        isPublished,
        typOspPagesActive,
        isExtensible: isPublished && typOspPagesActive === true,
      };
    });

    const publishedProfiles = profileInfos.filter((p) => p.isPublished);
    const typOspPagesEnabled = publishedProfiles.some((p) => p.typOspPagesActive === true);
    const hasTypOspField = profiles.some((node: { typOspPagesActive?: boolean }) => "typOspPagesActive" in node);

    if (!hasTypOspField) {
      logger.warn("typOspPagesActive field not in response; reporting unknown with FIELD_NOT_AVAILABLE");
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "FIELD_NOT_AVAILABLE",
        confidence: "low",
        checkedAt: new Date(),
        profiles: profileInfos,
        error: checkoutApiSupported
          ? "typOspPagesActive missing; shop reports checkoutApiSupported=true"
          : "typOspPagesActive missing",
      };
    }

    const status: TypOspStatus = typOspPagesEnabled ? "enabled" : "disabled";

    return {
      status,
      typOspPagesEnabled,
      confidence: status === "enabled" ? "high" : "medium",
      checkedAt: new Date(),
      profiles: profileInfos,
    };
  } catch (error) {
    logger.error("Failed to query checkout profiles:", error);
    
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "API_ERROR",
      confidence: "low",
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getTypOspStatusFromShopFeatures(admin: AdminApiContext): Promise<TypOspStatusResult> {
  try {
    const response = await admin.graphql(`
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
      logger.warn("GraphQL errors in shop features query:", data.errors);
      return {
        status: "unknown",
        typOspPagesEnabled: null,
        unknownReason: "API_ERROR",
        confidence: "low",
        checkedAt: new Date(),
        error: data.errors[0]?.message || "GraphQL error",
      };
    }

    const shop = data.data?.shop;
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    const isPlus = shop?.plan?.shopifyPlus === true;
    
    return {
      status: checkoutApiSupported ? "enabled" : "disabled",
      typOspPagesEnabled: checkoutApiSupported,
      confidence: isPlus && checkoutApiSupported ? "medium" : "low",
      checkedAt: new Date(),
    };
  } catch (error) {
    logger.error("Failed to query shop features:", error);
    
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "API_ERROR",
      confidence: "low",
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function refreshTypOspStatus(
  admin: AdminApiContext,
  shopId: string
): Promise<TypOspStatusResult> {
  const existingShop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { typOspPagesEnabled: true, typOspDetectedAt: true },
  });

  let result = await getTypOspActive(admin);
  
  if (result.status === "unknown" && result.unknownReason !== "NO_ADMIN_CONTEXT") {
    logger.info(`checkoutProfiles query returned unknown (${result.unknownReason}), trying shop features fallback`);
    const fallbackResult = await getTypOspStatusFromShopFeatures(admin);
    
    if (fallbackResult.status !== "unknown") {
      result = fallbackResult;
    }
  }
  
  try {
    const updateData: {
      typOspPagesEnabled: boolean | null;
      typOspUpdatedAt: Date;
      typOspLastCheckedAt: Date;
      typOspStatusReason?: string | null;
      typOspDetectedAt?: Date | null;
    } = {
      typOspPagesEnabled: result.typOspPagesEnabled,
      typOspUpdatedAt: result.checkedAt,
      typOspLastCheckedAt: result.checkedAt,
      typOspStatusReason: result.status === "unknown" ? result.unknownReason || null : null,
    };

    if (result.typOspPagesEnabled === true) {
      updateData.typOspDetectedAt = existingShop?.typOspDetectedAt || result.checkedAt;
    }
    
    if (result.status === "unknown" && result.unknownReason) {
      logger.info(`TYP/OSP status unknown for shop ${shopId}`, {
        reason: result.unknownReason,
        error: result.error,
      });
    }
    
    await prisma.shop.update({
      where: { id: shopId },
      data: updateData,
    });
    
    logger.info(`Updated typOspPagesEnabled=${result.typOspPagesEnabled} for shop ${shopId}`, {
      status: result.status,
      confidence: result.confidence,
      reason: result.unknownReason,
    });
  } catch (dbError) {
    logger.error("Failed to persist TYP/OSP status:", dbError);
  }
  
  return result;
}

export async function getCachedTypOspStatus(shopId: string): Promise<{
  status: TypOspStatus;
  typOspPagesEnabled: boolean | null;
  isStale: boolean;
  lastUpdated: Date | null;
}> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      typOspPagesEnabled: true,
      typOspUpdatedAt: true,
      typOspLastCheckedAt: true,
    },
  });
  
  if (!shop) {
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      isStale: true,
      lastUpdated: null,
    };
  }
  
  const staleThreshold = 24 * 60 * 60 * 1000;
  const lastChecked = shop.typOspLastCheckedAt || shop.typOspUpdatedAt;
  const isStale = !lastChecked ||
    (Date.now() - lastChecked.getTime()) > staleThreshold;
  
  let status: TypOspStatus;
  if (shop.typOspPagesEnabled === true) {
    status = "enabled";
  } else if (shop.typOspPagesEnabled === false) {
    status = "disabled";
  } else {
    status = "unknown";
  }
  
  return {
    status,
    typOspPagesEnabled: shop.typOspPagesEnabled,
    isStale,
    lastUpdated: lastChecked,
  };
}

export async function refreshTypOspStatusWithOfflineToken(
  shopId: string,
  shopDomain: string
): Promise<TypOspStatusResult> {
  const { createAdminClientForShop } = await import("../shopify.server");
  
  const admin = await createAdminClientForShop(shopDomain);
  
  if (!admin) {
    logger.warn(`No admin client for ${shopDomain}, cannot refresh TYP/OSP status`);
    return {
      status: "unknown",
      typOspPagesEnabled: null,
      unknownReason: "NO_ADMIN_CONTEXT",
      confidence: "low",
      checkedAt: new Date(),
      error: "No offline session available",
    };
  }
  
  return refreshTypOspStatus(admin, shopId);
}
