import { useLoaderData } from "@remix-run/react";
import { Page, BlockStack, Card, Text, Button, InlineStack, Banner } from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import type { loader } from "./app._index/loader.server";

export { loader } from "./app._index/loader.server";

export default function Index() {
  const { t } = useTranslation();
  const { dataConnection } = useLoaderData<typeof loader>();
  
  const isSetupComplete = dataConnection.hasIngestionSecret && 
                          dataConnection.hasWebPixel && 
                          dataConnection.webPixelHasIngestionKey;

  return (
    <Page title={t("dashboard.title")}>
      <BlockStack gap="500">
        {!isSetupComplete ? (
          <Banner
            title={t("dashboard.setupRequired.title", "Setup Required")}
            tone="warning"
          >
            <p>{t("dashboard.setupRequired.description", "Please configure your pixel to start tracking.")}</p>
          </Banner>
        ) : (
          <Banner
            title={t("dashboard.setupComplete.title", "System Active")}
            tone="success"
          >
            <p>{t("dashboard.setupComplete.description", "Your pixel is active and receiving events.")}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              {t("dashboard.quickActions", "Quick Actions")}
            </Text>
            <InlineStack gap="300">
              <Button url="/app/pixels" variant="primary">
                {t("nav.pixels")}
              </Button>
              <Button url="/app/verification">
                {t("nav.verification")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
