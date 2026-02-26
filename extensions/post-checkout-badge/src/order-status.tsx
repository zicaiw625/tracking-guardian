import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { getExtensionCopy, resolveExtensionLanguage } from "./i18n";
import { normalizeExtensionUrl } from "./url";

type ExtensionSettings = {
  ui_language?: string;
  show_banner?: boolean;
  banner_title?: string;
  show_invoice_button?: boolean;
  invoice_button_text?: string;
  invoice_url?: string;
  show_survey_link?: boolean;
  survey_button_text?: string;
  survey_url?: string;
  show_aftersales_link?: boolean;
  aftersales_button_text?: string;
  aftersales_url?: string;
};

export default async () => {
  render(<OrderStatusExtension />, document.body);
};

function getSettings(): ExtensionSettings {
  const runtime = globalThis as {
    shopify?: {
      settings?: {
        value?: ExtensionSettings;
      };
    };
  };
  return runtime.shopify?.settings?.value ?? {};
}

function OrderStatusExtension() {
  const settings = getSettings();
  const language = resolveExtensionLanguage(settings.ui_language);
  const copy = getExtensionCopy(language);
  const showBanner = settings.show_banner === true;
  const bannerTitle =
    typeof settings.banner_title === "string" && settings.banner_title.trim()
      ? settings.banner_title
      : "";
  const showInvoice = settings.show_invoice_button === true;
  const invoiceText =
    typeof settings.invoice_button_text === "string" &&
    settings.invoice_button_text.trim()
      ? settings.invoice_button_text
      : copy.invoice;
  const invoiceUrl = normalizeExtensionUrl(settings.invoice_url);
  const showSurvey = settings.show_survey_link === true;
  const surveyText =
    typeof settings.survey_button_text === "string" &&
    settings.survey_button_text.trim()
      ? settings.survey_button_text
      : copy.survey;
  const surveyUrl = normalizeExtensionUrl(settings.survey_url);
  const showAftersales = settings.show_aftersales_link === true;
  const aftersalesText =
    typeof settings.aftersales_button_text === "string" &&
    settings.aftersales_button_text.trim()
      ? settings.aftersales_button_text
      : copy.aftersales;
  const aftersalesUrl = normalizeExtensionUrl(settings.aftersales_url);

  return (
    <s-stack direction="block">
      {showBanner && (
        <s-banner heading={bannerTitle}>
          <s-text>{copy.orderStatusBannerBody}</s-text>
        </s-banner>
      )}
      {showInvoice && invoiceUrl && <s-link href={invoiceUrl}>{invoiceText}</s-link>}
      {showSurvey && surveyUrl && <s-link href={surveyUrl}>{surveyText}</s-link>}
      {showAftersales && aftersalesUrl && (
        <s-link href={aftersalesUrl}>{aftersalesText}</s-link>
      )}
    </s-stack>
  );
}
