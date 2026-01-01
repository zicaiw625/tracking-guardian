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
import { useMemo } from "react";

export default reactExtension("customer-account.order-status.block.render", () => <SupportOrderStatus />);

function SupportOrderStatus() {
  const settings = useSettings();

  const title = (settings.support_title as string) || "订单帮助与售后";
  const description =
    (settings.support_description as string) ||
    "在这里快速获取物流、售后与常见问题的官方入口。";
  
  // 构建完整 URL：如果配置的是相对路径，在 Customer Account 域下相对路径应该能正确解析
  // 但为了安全起见，如果配置的是绝对 URL，直接使用；如果是相对路径，保持原样
  // 注意：Customer Account extensions 运行在 customer account 域下，相对路径会解析到 storefront
  const faqUrl = useMemo(() => {
    const url = (settings.support_faq_url as string) || "/pages/faq";
    // 如果是绝对 URL（http:// 或 https://），直接使用
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    // 相对路径在 Customer Account 域下应该能正确解析到 storefront
    return url;
  }, [settings.support_faq_url]);
  
  const contactEmail = settings.support_contact_email as string | undefined;
  const contactUrl = useMemo(() => {
    const url = (settings.support_contact_url as string) || (contactEmail ? `mailto:${contactEmail}` : "/pages/contact");
    // mailto: 链接直接使用
    if (url.startsWith("mailto:")) {
      return url;
    }
    // 如果是绝对 URL，直接使用
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    // 相对路径在 Customer Account 域下应该能正确解析到 storefront
    return url;
  }, [settings.support_contact_url, contactEmail]);
  
  const whatsappNumber = settings.support_whatsapp_number as string | undefined;
  const messengerUrl = settings.support_messenger_url as string | undefined;
  
  const continueShoppingUrl = useMemo(() => {
    const url = (settings.continue_shopping_url as string) || "/";
    // 如果是绝对 URL，直接使用
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    // 相对路径在 Customer Account 域下应该能正确解析到 storefront
    return url;
  }, [settings.continue_shopping_url]);

  const emailUrl = contactEmail ? `mailto:${contactEmail}` : undefined;
  const whatsappUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}` : undefined;

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
