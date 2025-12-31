

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
  Banner,
  Image,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";
import { BACKEND_URL } from "../../shared/config";

export default reactExtension("purchase.thank-you.block.render", () => <Reorder />);

const Reorder = memo(function Reorder() {
  const settings = useSettings();
  const api = useApi();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [reorderUrl, setReorderUrl] = useState<string>('/cart');

  const title = useMemo(() => (settings.reorder_title as string) || "📦 再次购买", [settings.reorder_title]);
  const subtitle = useMemo(() => (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品", [settings.reorder_subtitle]);
  const buttonText = useMemo(() => (settings.reorder_button_text as string) || "再次购买 →", [settings.reorder_button_text]);
  const showItems = useMemo(() => settings.reorder_show_items !== "false", [settings.reorder_show_items]);

  // 使用 orderConfirmation API 获取订单 ID
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
            
            // 如果有订单 ID，尝试通过后端获取重新购买 URL
            if (orderData.id && api.sessionToken && BACKEND_URL) {
              try {
                const token = await api.sessionToken.get();
                const shopDomain = api.shop?.myshopifyDomain || "";
                
                if (token && shopDomain) {
                  const response = await fetch(`${BACKEND_URL}/api/reorder?orderId=${encodeURIComponent(orderData.id)}`, {
                    headers: {
                      "Content-Type": "application/json",
                      "X-Shopify-Shop-Domain": shopDomain,
                      "Authorization": `Bearer ${token}`,
                    },
                  });
                  
                  if (response.ok) {
                    const data = await response.json();
                    if (data.reorderUrl) {
                      setReorderUrl(data.reorderUrl);
                    }
                  }
                }
              } catch (error) {
                // 如果后端请求失败，使用默认的购物车 URL
                console.warn("Failed to get reorder URL from backend:", error);
              }
            }
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
      {orderNumber && (
        <BlockStack spacing="tight">
          <Text size="small" appearance="subdued">
            订单编号: {orderNumber}
          </Text>
        </BlockStack>
      )}

      {}
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

