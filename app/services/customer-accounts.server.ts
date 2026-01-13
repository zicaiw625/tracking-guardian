import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { logger } from "../utils/logger.server";

export interface CustomerAccountsStatus {
  enabled: boolean;
  checkedAt: Date;
  error?: string;
  confidence: "high" | "medium" | "low";
}

export async function checkCustomerAccountsEnabled(
  admin: AdminApiContext
): Promise<CustomerAccountsStatus> {
  try {
    const response = await admin.graphql(`
      query GetCustomerAccountsStatus {
        shop {
          checkoutApiSupported
          features {
            customerAccounts
          }
        }
      }
    `);

    const data = await response.json() as {
      data?: {
        shop?: {
          checkoutApiSupported?: boolean;
          features?: {
            customerAccounts?: boolean;
          };
        };
      };
      errors?: Array<{ message?: string }>;
    };

    if (data.errors) {
      logger.warn("GraphQL errors in customer accounts check:", { errors: data.errors });
      return {
        enabled: false,
        checkedAt: new Date(),
        error: data.errors[0]?.message || "Unknown error",
        confidence: "low",
      };
    }

    const shop = data.data?.shop;
    const checkoutApiSupported = shop?.checkoutApiSupported === true;
    const customerAccountsFeature = shop?.features?.customerAccounts === true;

    const enabled = checkoutApiSupported || customerAccountsFeature;

    return {
      enabled,
      checkedAt: new Date(),
      confidence: checkoutApiSupported ? "high" : customerAccountsFeature ? "medium" : "low",
    };
  } catch (error) {
    logger.error("Failed to check Customer Accounts status:", error);
    return {
      enabled: false,
      checkedAt: new Date(),
      error: error instanceof Error ? error.message : "Unknown error",
      confidence: "low",
    };
  }
}
