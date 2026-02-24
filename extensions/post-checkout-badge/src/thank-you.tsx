import {
  reactExtension,
  Banner,
  Text,
  BlockStack,
  Link,
  useSettings,
} from "@shopify/ui-extensions-react/checkout";
import { getExtensionCopy, resolveExtensionLanguage } from "./i18n";

export default reactExtension(
  "purchase.thank-you.customer-information.render-after",
  function ThankYouExtension() {
    const settings = useSettings();
    const language = resolveExtensionLanguage(settings.ui_language);
    const copy = getExtensionCopy(language);
    const showBanner = settings.show_banner === true;
    const bannerTitle = typeof settings.banner_title === "string" && settings.banner_title.trim() ? settings.banner_title : "";
    const showInvoice = settings.show_invoice_button === true;
    const invoiceText = typeof settings.invoice_button_text === "string" && settings.invoice_button_text.trim() ? settings.invoice_button_text : copy.invoice;
    const invoiceUrl = typeof settings.invoice_url === "string" && settings.invoice_url.trim() ? settings.invoice_url : "";
    const showSurvey = settings.show_survey_link === true;
    const surveyText = typeof settings.survey_button_text === "string" && settings.survey_button_text.trim() ? settings.survey_button_text : copy.survey;
    const surveyUrl = typeof settings.survey_url === "string" && settings.survey_url.trim() ? settings.survey_url : "";
    const showAftersales = settings.show_aftersales_link === true;
    const aftersalesText = typeof settings.aftersales_button_text === "string" && settings.aftersales_button_text.trim() ? settings.aftersales_button_text : copy.aftersales;
    const aftersalesUrl = typeof settings.aftersales_url === "string" && settings.aftersales_url.trim() ? settings.aftersales_url : "";

    return (
      <BlockStack spacing="loose">
        {showBanner && (
          <Banner title={bannerTitle}>
            <Text>{copy.thankYouBannerBody}</Text>
          </Banner>
        )}
        {showInvoice && invoiceUrl && (
          <Link to={invoiceUrl}>{invoiceText}</Link>
        )}
        {showSurvey && surveyUrl && (
          <Link to={surveyUrl}>{surveyText}</Link>
        )}
        {showAftersales && aftersalesUrl && (
          <Link to={aftersalesUrl}>{aftersalesText}</Link>
        )}
      </BlockStack>
    );
  }
);
