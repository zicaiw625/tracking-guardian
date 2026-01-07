

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
  Image,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";

export default reactExtension("customer-account.order-status.block.render", () => <ReorderOrderStatus />);

function ReorderOrderStatus() {
  const settings = useSettings();
  const order = useOrder();

  const title = (settings.reorder_title as string) || "📦 再次购买";
  const subtitle = (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品";
  const buttonText = (settings.reorder_button_text as string) || "再次购买 →";
  const showItems = settings.reorder_show_items !== "false";

  const lineItems: any[] = (order && 'lineItems' in order && Array.isArray(order.lineItems))
    ? order.lineItems as any[]
    : [];
  const totalPrice: { amount: string; currencyCode: string } | null =
    (order && 'totalPrice' in order && order.totalPrice && typeof order.totalPrice === 'object' && order.totalPrice !== null)
      ? order.totalPrice as { amount: string; currencyCode: string }
      : null;

  const generateReorderUrl = (): string => {
    if (!lineItems || lineItems.length === 0) {
      return '/cart';
    }

    const items = lineItems
      .filter((item: any) => item && item.quantity > 0)
      .map((item: any) => {
        const variantId = item.variant?.id || '';
        const numericId = variantId.split('/').pop() || '';
        return `${numericId}:${item.quantity}`;
      })
      .filter((item: string) => item && !item.startsWith(':'))
      .join(',');

    if (!items) {
      return '/cart';
    }

    return `/cart/${items}`;
  };

  if (!order || !lineItems || lineItems.length === 0) {
    return null;
  }

  const reorderUrl = generateReorderUrl();

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <BlockStack spacing="extraTight">
        <Text size="medium" emphasis="bold">
          {title}
        </Text>
        <Text size="small" appearance="subdued">
          {subtitle}
        </Text>
      </BlockStack>

      <Divider />

      {showItems && lineItems.length > 0 && (
        <BlockStack spacing="tight">
          <Text size="small" appearance="subdued">
            本次订购了 {lineItems.length} 件商品:
          </Text>
          {lineItems.slice(0, 3).map((item: any, index: number) => (
            <InlineLayout key={index} columns={["auto", "fill", "auto"]} spacing="tight" blockAlignment="center">
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
          {lineItems.length > 3 && (
            <Text size="extraSmall" appearance="subdued">
              +{lineItems.length - 3} 件其他商品
            </Text>
          )}
        </BlockStack>
      )}

      <View padding="tight" background="subdued" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <BlockStack spacing="none">
            <Text size="small" appearance="subdued">
              订单金额
            </Text>
            <Text size="medium" emphasis="bold">
              {totalPrice?.amount
                ? `${totalPrice.currencyCode} ${totalPrice.amount}`
                : '-'
              }
            </Text>
          </BlockStack>
          <Link to={reorderUrl}>
            <Button kind="primary">
              {buttonText}
            </Button>
          </Link>
        </InlineLayout>
      </View>

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
}

