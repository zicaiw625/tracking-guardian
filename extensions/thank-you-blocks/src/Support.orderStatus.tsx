import {
  reactExtension,
  BlockStack,
  InlineLayout,
  Text,
  Button,
  Link,
  View,
  useSettings,
} from "@shopify/ui-extensions-react/customer-account";

export default reactExtension("customer-account.order-status.block.render", () => <SupportOrderStatus />);

function SupportOrderStatus() {
  const settings = useSettings();

  const title = (settings.support_title as string) || "订单帮助与售后";
  const description =
    (settings.support_description as string) ||
    "在这里快速获取物流、售后与常见问题的官方入口。";
  const faqUrl = (settings.support_faq_url as string) || "/pages/faq";
  const contactEmail = settings.support_contact_email as string | undefined;
  const contactUrl = (settings.support_contact_url as string) || (contactEmail ? `mailto:${contactEmail}` : "/pages/contact");
  const whatsappNumber = settings.support_whatsapp_number as string | undefined;
  const messengerUrl = settings.support_messenger_url as string | undefined;
  const continueShoppingUrl = (settings.continue_shopping_url as string) || "/";

  const emailUrl = contactEmail ? `mailto:${contactEmail}` : undefined;
  const whatsappUrl = whatsappNumber ? `https:

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
            <Text size="small">🔄</Text>
            <Text size="small" appearance="subdued">
              查看订单更新、退款进度或重发收据
            </Text>
          </InlineLayout>
          <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
            <Text size="small">✉️</Text>
            <Text size="small" appearance="subdued">
              专属客服入口：售后、换货、尺寸/安装咨询
            </Text>
          </InlineLayout>
          <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
            <Text size="small">📚</Text>
            <Text size="small" appearance="subdued">
              FAQ/政策集中查看，减少往返沟通
            </Text>
          </InlineLayout>
        </BlockStack>
      </View>

      <BlockStack spacing="tight">
        {}
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

        {}
        <Link to={faqUrl}>
          <Button kind="secondary" submit={false}>
            ❓ FAQ / 帮助中心
          </Button>
        </Link>
      </BlockStack>

      <Link to={continueShoppingUrl}>
        <Button kind="plain">继续购物</Button>
      </Link>
    </BlockStack>
  );
}
