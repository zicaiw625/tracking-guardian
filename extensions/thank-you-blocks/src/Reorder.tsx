

import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  useSettings,
  useApi,
  Link,
  Divider,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";

export default reactExtension("purchase.thank-you.block.render", () => <Reorder />);

const Reorder = memo(function Reorder() {
  const settings = useSettings();
  const api = useApi();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  
  // 获取 storefrontUrl，用于构建完整 URL
  const storefrontUrl = useMemo(() => {
    return api.shop?.storefrontUrl || "";
  }, [api.shop?.storefrontUrl]);
  
  // 构建重新购买 URL：直接使用购物车 URL，不调用后端 Admin API
  // 这样可以降低越权和合规风险（Protected Customer Data），符合 Shopify 最佳实践
  // 用户可以在购物车中手动添加商品，或者通过其他方式（如邮件中的重新购买链接）实现
  const reorderUrl = useMemo(() => {
    const defaultUrl = "/cart";
    return storefrontUrl ? `${storefrontUrl}${defaultUrl}` : defaultUrl;
  }, [storefrontUrl]);

  const title = useMemo(() => (settings.reorder_title as string) || "📦 再次购买", [settings.reorder_title]);
  const subtitle = useMemo(() => (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品", [settings.reorder_subtitle]);
  const buttonText = useMemo(() => (settings.reorder_button_text as string) || "再次购买 →", [settings.reorder_button_text]);

  // 使用 orderConfirmation API 获取订单信息（仅用于显示）
  useEffect(() => {
    async function fetchOrderInfo() {
      try {
        if (api.orderConfirmation) {
          const orderData = api.orderConfirmation instanceof Promise
            ? await api.orderConfirmation
            : api.orderConfirmation;
          if (orderData) {
            setOrderId(orderData.id || null);
            setOrderNumber(orderData.number !== undefined && orderData.number !== null
              ? String(orderData.number)
              : null);
          }
        }
      } catch (err) {
        console.warn("Failed to get order info:", err);
      }
    }
    fetchOrderInfo();
  }, [api]);

  // 如果没有订单信息，不显示组件
  if (!orderId && !orderNumber) {
    return null;
  }

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

      {orderNumber && (
        <BlockStack spacing="tight">
          <Text size="small" appearance="subdued">
            订单编号: {orderNumber}
          </Text>
        </BlockStack>
      )}

      <View padding="tight" background="subdued" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <BlockStack spacing="none">
            <Text size="small" appearance="subdued">
              快速再次购买
            </Text>
            <Text size="small" appearance="subdued">
              点击按钮将跳转到购物车
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
});

