import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  List,
  Box,
  Link,
} from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({
    lastUpdated: "December 2024",
    contactEmail: "support@tracking-guardian.app", // Replace with actual email
  });
};

export default function PublicPrivacyPolicy() {
  const { lastUpdated, contactEmail } = useLoaderData<typeof loader>();

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem" }}>
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Privacy Policy
          </Text>
          <Text as="p" tone="subdued">
            Last Updated: {lastUpdated}
          </Text>
        </BlockStack>

        <Card>
          <BlockStack gap="400">
            <Text as="p">
              This privacy policy describes how Tracking Guardian (&quot;we&quot;, &quot;our&quot;,
              &quot;the App&quot;) collects, uses, and protects data when merchants
              install and use our Shopify application.
            </Text>

            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                1. Data We Collect
              </Text>
              <Text as="h3" variant="headingMd">
                1.1 Order Data (from Shopify Webhooks)
              </Text>
              <List type="bullet">
                <List.Item>
                  <strong>Order ID & Number:</strong> For conversion tracking,
                  deduplication, and dashboard display.
                </List.Item>
                <List.Item>
                  <strong>Order Value & Currency:</strong> For revenue
                  attribution and accurate reporting.
                </List.Item>
                <List.Item>
                  <strong>Line Items:</strong> Product IDs, names, and
                  quantities for product-level attribution.
                </List.Item>
                <List.Item>
                  <strong>Checkout Token:</strong> For correlating pixel events
                  with server-side orders.
                </List.Item>
              </List>

              <Text as="h3" variant="headingMd">
                1.2 Pixel Event Data (from Web Pixel)
              </Text>
              <List type="bullet">
                <List.Item>
                  <strong>Event Type:</strong> We ONLY collect{" "}
                  <code>checkout_completed</code> events.
                </List.Item>
                <List.Item>
                  <strong>Event Metadata:</strong> Timestamp, Shop Domain, and
                  Consent State.
                </List.Item>
              </List>

              <Text as="h3" variant="headingMd">
                1.3 What We DO NOT Collect
              </Text>
              <Text as="p">
                We explicitly <strong>DO NOT</strong> collect or send to ad
                platforms:
              </Text>
              <List type="bullet">
                <List.Item>Browsing history (Page views)</List.Item>
                <List.Item>Add to cart events</List.Item>
                <List.Item>Customer email addresses (PII)</List.Item>
                <List.Item>Customer phone numbers (PII)</List.Item>
                <List.Item>Customer names or addresses (PII)</List.Item>
                <List.Item>Payment information</List.Item>
              </List>
            </BlockStack>

            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                2. How We Use Data
              </Text>
              <Text as="p">We process order data to:</Text>
              <List type="number">
                <List.Item>
                  <strong>Send conversion events</strong> to advertising
                  platforms (Google GA4, Meta CAPI, TikTok Events API) configured
                  by the merchant.
                </List.Item>
                <List.Item>
                  <strong>Deduplicate events</strong> between client-side pixels
                  and server-side API.
                </List.Item>
                <List.Item>
                  <strong>Provide reconciliation reports</strong> comparing
                  Shopify orders with platform-reported conversions.
                </List.Item>
              </List>
            </BlockStack>

            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                3. Data Sharing
              </Text>
              <Text as="p">
                When merchants configure server-side tracking AND customers
                consent, we share minimal order data (Order ID, Value, Currency,
                Items) with:
              </Text>
              <List type="bullet">
                <List.Item>Google Analytics 4 (GA4)</List.Item>
                <List.Item>Meta (Facebook) Conversions API</List.Item>
                <List.Item>TikTok Events API</List.Item>
              </List>
              <Text as="p" fontWeight="bold">
                We DO NOT share customer PII (email, phone, name, address) with
                these platforms.
              </Text>
            </BlockStack>

            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                4. Data Retention & Deletion
              </Text>
              <List type="bullet">
                <List.Item>
                  <strong>Retention:</strong> Merchants can configure data
                  retention (30-365 days). Default is 90 days.
                </List.Item>
                <List.Item>
                  <strong>Uninstall:</strong> All shop data is automatically
                  deleted 48 hours after the app is uninstalled via the{" "}
                  <code>shop/redact</code> webhook.
                </List.Item>
                <List.Item>
                  <strong>GDPR Rights:</strong> We support{" "}
                  <code>customers/data_request</code> and{" "}
                  <code>customers/redact</code> webhooks to handle customer data
                  rights.
                </List.Item>
              </List>
            </BlockStack>

            <BlockStack gap="200">
              <Text as="h2" variant="headingLg">
                5. Contact
              </Text>
              <Text as="p">
                For privacy-related inquiries, please contact us at:{" "}
                <Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </div>
  );
}
