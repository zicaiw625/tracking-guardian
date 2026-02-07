import {
  AppProvider,
  Box,
  InlineStack,
  Text,
  Page,
  FooterHelp,
  Link,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import polarisTranslationsEn from "@shopify/polaris/locales/en.json" with { type: "json" };
import polarisTranslationsZh from "@shopify/polaris/locales/zh-CN.json" with { type: "json" };
import { getPolarisTranslations } from "~/utils/polaris-i18n";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

interface PublicLayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
}

export function PublicLayout({ children, showFooter = true }: PublicLayoutProps) {
  const { t, i18n } = useTranslation();

  const polarisTranslations = i18n.language?.startsWith("zh")
    ? polarisTranslationsZh
    : polarisTranslationsEn;
  const polarisI18n = getPolarisTranslations(polarisTranslations);

  return (
    <AppProvider i18n={polarisI18n as any}>
      <Box minHeight="100vh" background="bg-surface-secondary">
        {/* Header */}
        <Box
          background="bg-surface"
          paddingBlock="400"
          paddingInline="400"
          borderBlockEndWidth="025"
          borderColor="border"
        >
          <Page fullWidth>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                {/* Optional: Add Logo here */}
                <Text as="h1" variant="headingMd" fontWeight="semibold">
                  Tracking Guardian
                </Text>
              </InlineStack>
              <LanguageSwitcher />
            </InlineStack>
          </Page>
        </Box>

        {/* Content */}
        <Box paddingBlock="800">
           {children}
        </Box>

        {/* Footer */}
        {showFooter && (
          <Box paddingBlock="800">
            <FooterHelp>
              <InlineStack gap="400">
                <Link url="/privacy">{t("PublicPrivacy.Title")}</Link>
                <Link url="/terms">{t("PublicTerms.Title")}</Link>
                <Link url="/support">{t("PublicSupport.Title")}</Link>
              </InlineStack>
            </FooterHelp>
          </Box>
        )}
      </Box>
    </AppProvider>
  );
}
