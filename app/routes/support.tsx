import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  List,
  Link,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import translations from "@shopify/polaris/locales/en.json" with { type: "json" };
import { getPolarisTranslations } from "../utils/polaris-i18n";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";

const i18n = getPolarisTranslations(translations);

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const response = json({
    host: url.host,
    contactEmail: "support@tracking-guardian.app",
    faqUrl: "https://help.tracking-guardian.app",
  });
  const headers = new Headers(response.headers);
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default function PublicSupportPage() {
  const { contactEmail } = useLoaderData<typeof loader>();
  return (
    <AppProvider i18n={i18n as any}>
      <Page title="Support & FAQ" subtitle="Tracking Guardian Help Center">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Contact & Support
                  </Text>
                  <Text as="p">
                    Need help with checkout/Thank you migration or Web Pixel events? The current version focuses on migration, verification, and gap monitoring; server-side conversion delivery is optional and off by default. Reach out anytime:
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      Email: <Link url={`mailto:${contactEmail}`}>{contactEmail}</Link>
                    </List.Item>
                    <List.Item>
                      Data rights (GDPR/CCPA): use{" "}
                      <Text as="span" fontWeight="bold">
                        customers/data_request
                      </Text>{" "}
                      or{" "}
                      <Text as="span" fontWeight="bold">
                        customers/redact
                      </Text>{" "}
                      per Shopify, or email us directly.
                    </List.Item>
                    <List.Item>
                      Status page:{" "}
                      <Link url="https://status.tracking-guardian.app">
                        status.tracking-guardian.app
                      </Link>
                    </List.Item>
                  </List>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Quick FAQ
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        Do you require PII/PCD?
                      </Text>{" "}
                      We do not collect end-customer PII, and the public App Store
                      version does not request Shopify order scopes or access
                      Protected Customer Data (PCD). Any future features that
                      rely on order-level reconciliation or Reorder flows will
                      ship only after explicit PCD approval and with updated
                      privacy documentation.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        What events are collected?
                      </Text>{" "}
                      By default, Web Pixel subscribes to{" "}
                      <code>checkout_completed</code> only (purchase_only mode). 
                      Optional full_funnel mode can be enabled by merchants to collect additional events 
                      (checkout_started, page_viewed, add_to_cart, product_viewed, checkout_contact_info_submitted, 
                      checkout_shipping_info_submitted, payment_info_submitted) with explicit merchant consent and 
                      proper privacy policy disclosure.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        How is consent handled?
                      </Text>{" "}
                      Client-side consent follows Shopify{" "}
                      <code>customerPrivacy</code>.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        Data retention & deletion
                      </Text>{" "}
                      Defaults to 90 days. All shop data is auto-deleted within 48h
                      of uninstall via <code>shop/redact</code>.
                    </List.Item>
                  </List>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingLg">
                    Migration tips
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      Run the in-app scanner to detect ScriptTags/old pixels. The
                      scanner paginates Shopify results (ScriptTags up to 1000,
                      Web Pixels up to 200) and warns if limits are hit.
                    </List.Item>
                    <List.Item>
                      For Additional Scripts (Thank you/Order status), paste the
                      snippet into the manual analyzer on the scan page so nothing
                      is missed.
                    </List.Item>
                    <List.Item>
                      Confirm the Tracking Guardian Web Pixel is installed from the
                      “迁移” page; then you can safely remove legacy ScriptTags.
                    </List.Item>
                  </List>
                </BlockStack>
                <InlineStack gap="200">
                  <Badge tone="success">Public</Badge>
                  <Badge tone="info">No login required</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}
