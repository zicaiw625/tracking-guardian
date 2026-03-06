import type {
  AdminGraphQL,
  GraphQLEnvelope,
  SubscriptionNode,
} from "./subscription.types";

export const GET_SUBSCRIPTION_QUERY = `
  query GetSubscription {
    appInstallation {
      allSubscriptions(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            status
            trialDays
            createdAt
            currentPeriodEnd
            test
            lineItems {
              id
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price {
                      amount
                      currencyCode
                    }
                    interval
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const CREATE_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      replacementBehavior: $replacementBehavior
    ) {
      appSubscription {
        id
        status
        trialDays
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CREATE_ONE_TIME_PURCHASE_MUTATION = `
  mutation AppPurchaseOneTimeCreate(
    $name: String!
    $price: MoneyInput!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appPurchaseOneTimeCreate(
      name: $name
      price: $price
      returnUrl: $returnUrl
      test: $test
    ) {
      appPurchaseOneTime {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_ONE_TIME_PURCHASES_QUERY = `
  query GetOneTimePurchases {
    appInstallation {
      oneTimePurchases(first: 50, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            status
            price {
              amount
              currencyCode
            }
            createdAt
          }
        }
      }
    }
  }
`;

export async function adminGraphqlOrThrow<T>(
  admin: AdminGraphQL,
  query: string,
  options?: { variables?: Record<string, unknown> },
  operationName?: string
): Promise<T> {
  const response = await admin.graphql(query, options);
  const status =
    typeof (response as { status?: number }).status === "number"
      ? ((response as { status?: number }).status as number)
      : 0;
  const ok =
    typeof (response as { ok?: boolean }).ok === "boolean"
      ? Boolean((response as { ok?: boolean }).ok)
      : status >= 200 && status < 300;
  if (!ok) {
    throw new Error(
      `Shopify GraphQL request failed (${operationName || "unknown"}): HTTP ${status}`
    );
  }
  const payload = (await response.json()) as GraphQLEnvelope<T>;
  const topLevelErrors = Array.isArray(payload?.errors) ? payload.errors : [];
  if (topLevelErrors.length > 0) {
    const message = topLevelErrors
      .map((error) => error?.message || "Unknown GraphQL error")
      .join(", ");
    throw new Error(
      `Shopify GraphQL response errors (${operationName || "unknown"}): ${message}`
    );
  }
  if (!payload || payload.data === undefined || payload.data === null) {
    throw new Error(
      `Shopify GraphQL response missing data (${operationName || "unknown"})`
    );
  }
  return payload.data;
}

export async function getAllSubscriptions(
  admin: AdminGraphQL
): Promise<SubscriptionNode[]> {
  const data = await adminGraphqlOrThrow<{
    appInstallation?: {
      allSubscriptions?: {
        edges?: Array<{ node: unknown }>;
      };
    };
  }>(admin, GET_SUBSCRIPTION_QUERY, undefined, "GET_SUBSCRIPTION_QUERY");
  const subscriptionsConnection = data.appInstallation?.allSubscriptions;
  return (
    subscriptionsConnection?.edges?.map(
      (edge: { node: unknown }) => edge.node as SubscriptionNode
    ) || []
  );
}
