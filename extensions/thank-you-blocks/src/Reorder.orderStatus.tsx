/**
 * Reorder Block - Order Status Page (Customer Account)
 * 对应设计方案 4.4 再购按钮（Reorder）
 * 
 * 功能：生成"再次购买"购物车链接（基于订单 line items）
 */

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

  // 设置项
  const title = (settings.reorder_title as string) || "📦 再次购买";
  const subtitle = (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品";
  const buttonText = (settings.reorder_button_text as string) || "再次购买 →";
  const showItems = settings.reorder_show_items !== "false"; // 默认显示商品列表

  // 生成再次购买的购物车 URL
  const generateReorderUrl = (): string => {
    if (!order?.lineItems || order.lineItems.length === 0) {
      return '/cart';
    }

    // 构建购物车 URL 参数
    // 格式: /cart/variant_id:quantity,variant_id:quantity,...
    const items = order.lineItems
      .filter(item => item.quantity > 0)
      .map(item => {
        // 从 variant ID 中提取数字部分
        // 通常格式是 gid://shopify/ProductVariant/12345
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
  };

  // 如果没有订单数据
  if (!order || !order.lineItems || order.lineItems.length === 0) {
    return null;
  }

  const reorderUrl = generateReorderUrl();

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      {/* 标题 */}
      <BlockStack spacing="extraTight">
        <Text size="medium" emphasis="bold">
          {title}
        </Text>
        <Text size="small" appearance="subdued">
          {subtitle}
        </Text>
      </BlockStack>

      <Divider />

      {/* 商品列表预览 */}
      {showItems && order.lineItems.length > 0 && (
        <BlockStack spacing="tight">
          <Text size="small" appearance="subdued">
            本次订购了 {order.lineItems.length} 件商品:
          </Text>
          {order.lineItems.slice(0, 3).map((item, index) => (
            <InlineLayout key={index} columns={["auto", "fill", "auto"]} spacing="tight" blockAlignment="center">
              {/* 商品图片（如果有） */}
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

      {/* 订单总结 */}
      <View padding="tight" background="subdued" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <BlockStack spacing="none">
            <Text size="small" appearance="subdued">
              订单金额
            </Text>
            <Text size="medium" emphasis="bold">
              {order.totalPrice?.amount 
                ? `${order.totalPrice.currencyCode} ${order.totalPrice.amount}`
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

      {/* 提示信息 */}
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

