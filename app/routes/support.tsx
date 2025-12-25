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
import translations from "@shopify/polaris/locales/en.json";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return json({
    host: url.host,
    contactEmail: "support@tracking-guardian.app",
    faqUrl: "https://tracking-guardian.app/support",
  });
};

export default function PublicSupportPage() {
  const { contactEmail } = useLoaderData<typeof loader>();

  return (
    <AppProvider i18n={translations}>
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
                    Need help with checkout/Thank you migration, Web Pixel, or CAPI
                    events? Reach out anytime:
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
                      <Link url="https://status.tracking-guardian.app" external>
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
                      No. The app works without PII. Enhanced matching is optional
                      and only available after Shopify PCD approval and merchant
                      opt-in.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        What events are collected?
                      </Text>{" "}
                      Web Pixel only subscribes to{" "}
                      <code>checkout_completed</code>. No browsing/add-to-cart
                      events are collected.
                    </List.Item>
                    <List.Item>
                      <Text as="span" fontWeight="bold">
                        How is consent handled?
                      </Text>{" "}
                      Client-side consent follows Shopify{" "}
                      <code>customerPrivacy</code>; server-side CAPI only fires
                      when consent is granted.
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
