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

export default reactExtension("purchase.thank-you.block.render", () => <SupportBlock />);

function SupportBlock() {
  const settings = useSettings();

  const title = (settings.support_title as string) || "订单帮助与售后";
  const description =
    (settings.support_description as string) ||
    "如需修改收件信息、查看售后政策或联系人工客服，请使用下方入口。";
  const faqUrl = (settings.support_faq_url as string) || "/pages/faq";
  const contactEmail = settings.support_contact_email as string;
  const contactUrl = (settings.support_contact_url as string) || (contactEmail ? `mailto:${contactEmail}` : "/pages/contact");
  const continueShoppingUrl = (settings.continue_shopping_url as string) || "/";

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

      <InlineLayout columns={["fill", "fill"]} spacing="tight" blockAlignment="center">
        <Link to={contactUrl}>
          <Button kind="primary" submit={false}>
            联系客服
          </Button>
        </Link>
        <Link to={faqUrl}>
          <Button kind="secondary" submit={false}>
            FAQ / 帮助中心
          </Button>
        </Link>
      </InlineLayout>

      <Link to={continueShoppingUrl}>
        <Button kind="plain">返回商店首页</Button>
      </Link>
    </BlockStack>
  );
}
