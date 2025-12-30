import {
  reactExtension,
  BlockStack,
  InlineLayout,
  Text,
  Button,
  Link,
  View,
  useSettings,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo } from "react";

export default reactExtension("purchase.thank-you.block.render", () => <SupportBlock />);

function SupportBlock() {
  const settings = useSettings();

  const title = useMemo(() => (settings.support_title as string) || "订单帮助与售后", [settings.support_title]);
  const description = useMemo(() =>
    (settings.support_description as string) ||
    "如需修改收件信息、查看售后政策或联系人工客服，请使用下方入口。", [settings.support_description]);
  const faqUrl = useMemo(() => (settings.support_faq_url as string) || "/pages/faq", [settings.support_faq_url]);
  const contactEmail = useMemo(() => settings.support_contact_email as string | undefined, [settings.support_contact_email]);
  const contactUrl = useMemo(() => settings.support_contact_url as string | undefined, [settings.support_contact_url]);
  const whatsappNumber = useMemo(() => settings.support_whatsapp_number as string | undefined, [settings.support_whatsapp_number]);
  const messengerUrl = useMemo(() => settings.support_messenger_url as string | undefined, [settings.support_messenger_url]);
  const continueShoppingUrl = useMemo(() => (settings.continue_shopping_url as string) || "/", [settings.continue_shopping_url]);
  
  // 生成联系链接
  const emailUrl = contactEmail ? `mailto:${contactEmail}` : undefined;
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}` : undefined;

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
        <BlockStack spacing="extraTight">
          <Text size="medium" emphasis="bold">
            {title}
          </Text>
          <Text size="small" appearance="subdued">
            {description}
          </Text>
        </BlockStack>
      </InlineLayout>

      <View padding="tight" background="subdued" cornerRadius="base">
        <BlockStack spacing="tight">
          <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
            <Text size="small">📦</Text>
            <Text size="small" appearance="subdued">
              查看发货/物流状态，或更新收件人信息
            </Text>
          </InlineLayout>
          <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
            <Text size="small">🧾</Text>
            <Text size="small" appearance="subdued">
              需要发票/收据或退款协助？请直接联系我们
            </Text>
          </InlineLayout>
          <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
            <Text size="small">❓</Text>
            <Text size="small" appearance="subdued">
              常见问题（配送/退换货/尺寸指南）集中查看
            </Text>
          </InlineLayout>
        </BlockStack>
      </View>

      <BlockStack spacing="tight">
        {/* 客服渠道按钮 */}
        {(emailUrl || contactUrl || whatsappUrl || messengerUrl) && (
          <BlockStack spacing="extraTight">
            <Text size="small" appearance="subdued">联系客服：</Text>
            <InlineLayout columns={["fill", "fill"]} spacing="tight" blockAlignment="center">
              {emailUrl && (
                <Link to={emailUrl}>
                  <Button kind="primary" submit={false}>
                    📧 邮件
                  </Button>
                </Link>
              )}
              {whatsappUrl && (
                <Link to={whatsappUrl}>
                  <Button kind="primary" submit={false}>
                    💬 WhatsApp
                  </Button>
                </Link>
              )}
              {messengerUrl && (
                <Link to={messengerUrl}>
                  <Button kind="primary" submit={false}>
                    💬 Messenger
                  </Button>
                </Link>
              )}
              {contactUrl && !emailUrl && !whatsappUrl && !messengerUrl && (
                <Link to={contactUrl}>
                  <Button kind="primary" submit={false}>
                    联系客服
                  </Button>
                </Link>
              )}
            </InlineLayout>
          </BlockStack>
        )}
        
        {/* FAQ 按钮 */}
        <Link to={faqUrl}>
          <Button kind="secondary" submit={false}>
            ❓ FAQ / 帮助中心
          </Button>
        </Link>
      </BlockStack>

      <Link to={continueShoppingUrl}>
        <Button kind="plain">返回商店首页</Button>
      </Link>
    </BlockStack>
  );
}
