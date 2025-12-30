

import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  useSettings,
  useOrder,
  Link,
  Divider,
  Banner,
  Image,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo } from "react";

export default reactExtension("purchase.thank-you.block.render", () => <Reorder />);

const Reorder = memo(function Reorder() {
  const settings = useSettings();
  const order = useOrder();

  const title = useMemo(() => (settings.reorder_title as string) || "📦 再次购买", [settings.reorder_title]);
  const subtitle = useMemo(() => (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品", [settings.reorder_subtitle]);
  const buttonText = useMemo(() => (settings.reorder_button_text as string) || "再次购买 →", [settings.reorder_button_text]);
  const showItems = useMemo(() => settings.reorder_show_items !== "false", [settings.reorder_show_items]);

  const reorderUrl = useMemo((): string => {
    if (!order?.lineItems || order.lineItems.length === 0) {
      return '/cart';
    }

    const items = order.lineItems
      .filter(item => item.quantity > 0)
      .map(item => {

        const variantId = item.variant?.id || '';
        const numericId = variantId.split('/').pop() || '';
        return `${numericId}:${item.quantity}`;
      })
      .filter(item => item && !item.startsWith(':'))
      .join(',');

    if (!items) {
      return '/cart';
    }

    return `/cart/${items}`;
  }, [order?.lineItems]);

  const orderTotalDisplay = useMemo(() => {
    if (!order?.totalPrice?.amount) return '-';
    return `${order.totalPrice.currencyCode} ${order.totalPrice.amount}`;
  }, [order?.totalPrice]);

  if (!order || !order.lineItems || order.lineItems.length === 0) {
    return null;
  }

  const displayedItems = useMemo(() => order.lineItems.slice(0, 3), [order.lineItems]);

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      {}
      <BlockStack spacing="extraTight">
        <Text size="medium" emphasis="bold">
          {title}
        </Text>
        <Text size="small" appearance="subdued">
          {subtitle}
        </Text>
      </BlockStack>

      <Divider />

      {}
      {showItems && order.lineItems.length > 0 && (
        <BlockStack spacing="tight">
          <Text size="small" appearance="subdued">
            本次订购了 {order.lineItems.length} 件商品:
          </Text>
          {displayedItems.map((item, index) => (
            <InlineLayout key={index} columns={["auto", "fill", "auto"]} spacing="tight" blockAlignment="center">
              {}
              {item.image?.url && (
                <View maxInlineSize={40}>
                  <Image
                    source={item.image.url}
                    accessibilityDescription={item.title}
                    aspectRatio={1}
                    cornerRadius="base"
                  />
                </View>
              )}
              <BlockStack spacing="none">
                <Text size="small" emphasis="bold">
                  {item.title}
                </Text>
                {item.variant?.title && item.variant.title !== 'Default Title' && (
                  <Text size="extraSmall" appearance="subdued">
                    {item.variant.title}
                  </Text>
                )}
              </BlockStack>
              <Text size="small">
                x{item.quantity}
              </Text>
            </InlineLayout>
          ))}
          {order.lineItems.length > 3 && (
            <Text size="extraSmall" appearance="subdued">
              +{order.lineItems.length - 3} 件其他商品
            </Text>
          )}
        </BlockStack>
      )}

      {}
      <View padding="tight" background="subdued" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <BlockStack spacing="none">
            <Text size="small" appearance="subdued">
              订单金额
            </Text>
            <Text size="medium" emphasis="bold">
              {orderTotalDisplay}
            </Text>
          </BlockStack>
          <Link to={reorderUrl}>
            <Button kind="primary">
              {buttonText}
            </Button>
          </Link>
        </InlineLayout>
      </View>

      {}
      <BlockStack spacing="extraTight">
        <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
          <Text size="small">💡</Text>
          <Text size="extraSmall" appearance="subdued">
            点击后将跳转到购物车，您可以在结账前修改数量
          </Text>
        </InlineLayout>
      </BlockStack>
    </BlockStack>
  );
});

