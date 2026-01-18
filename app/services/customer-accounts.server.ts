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
          customerAccounts
        }
      }
    `);

    const data = await response.json() as {
      data?: {
        shop?: {
          checkoutApiSupported?: boolean;
          customerAccounts?: "DISABLED" | "OPTIONAL" | "REQUIRED";
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
    const customerAccountsSetting = shop?.customerAccounts;
    const customerAccountsOn =
      customerAccountsSetting === "OPTIONAL" || customerAccountsSetting === "REQUIRED";

    const enabled = checkoutApiSupported || customerAccountsOn;

    return {
      enabled,
      checkedAt: new Date(),
      confidence: checkoutApiSupported ? "high" : customerAccountsOn ? "medium" : "low",
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
