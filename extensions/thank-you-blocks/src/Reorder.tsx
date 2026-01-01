

import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  useSettings,
  useApi,
  Divider,
  Banner,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";

export default reactExtension("purchase.thank-you.block.render", () => <Reorder />);

const Reorder = memo(function Reorder() {
  const settings = useSettings();
  const api = useApi();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [reorderUrl, setReorderUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendUrlError, setBackendUrlError] = useState(false);
  
  // 获取 storefrontUrl，用于构建完整 URL
  const storefrontUrl = useMemo(() => {
    return api.shop?.storefrontUrl || "";
  }, [api.shop?.storefrontUrl]);

  const title = useMemo(() => (settings.reorder_title as string) || "📦 再次购买", [settings.reorder_title]);
  const subtitle = useMemo(() => (settings.reorder_subtitle as string) || "喜欢这次购物？一键再次订购相同商品", [settings.reorder_subtitle]);
  const buttonText = useMemo(() => (settings.reorder_button_text as string) || "再次购买 →", [settings.reorder_button_text]);

  // 使用 orderConfirmation API 获取订单信息
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

  // 获取重新购买 URL（带重试逻辑）
  useEffect(() => {
    async function fetchReorderUrl() {
      if (!orderId) {
        return;
      }

      // 安全检查：确保 BACKEND_URL 是允许的域名
      if (!BACKEND_URL || !isAllowedBackendUrl(BACKEND_URL)) {
        console.warn("Reorder: Backend URL not configured or not allowed", { BACKEND_URL });
        setBackendUrlError(true);
        setError("后端服务配置错误，请联系商家");
        return;
      }

      setBackendUrlError(false);
      setError(null);
      setIsLoading(true);

      // 重试逻辑：Shopify 订单可能在 Thank you 页渲染时尚未创建完成
      // 使用指数退避：500ms, 1500ms, 3000ms，最多 3 次
      const retryDelays = [0, 500, 1500, 3000];
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        try {
          // 等待退避时间（第一次立即执行）
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt] - retryDelays[attempt - 1]));
          }

          const token = await api.sessionToken.get();
          const shopDomain = api.shop?.myshopifyDomain || "";

          if (!shopDomain || !token) {
            continue;
          }

          const response = await fetch(`${BACKEND_URL}/api/reorder?orderId=${encodeURIComponent(orderId)}`, {
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Shop-Domain": shopDomain,
              "Authorization": `Bearer ${token}`,
            },
          });

          // 处理 202 Accepted（订单正在生成，需要重试）
          if (response.status === 202) {
            const data = await response.json();
            const retryAfter = response.headers.get("Retry-After");
            const retryDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;

            // 如果还有重试机会，继续重试
            if (attempt < retryDelays.length - 1) {
              console.log(`Order still creating, retrying after ${retryDelay}ms`, { orderId, attempt });
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            } else {
              // 最后一次重试失败，显示友好提示
              setError(data.message || "订单正在生成，请稍后刷新页面");
              break;
            }
          }

          if (response.ok) {
            const data = await response.json();
            // 后端返回的是相对路径，需要拼接成绝对 URL
            const relativeUrl = data.reorderUrl || "/cart";
            const absoluteUrl = storefrontUrl 
              ? `${storefrontUrl}${relativeUrl.startsWith("/") ? relativeUrl : `/${relativeUrl}`}`
              : relativeUrl;
            setReorderUrl(absoluteUrl);
            setError(null);
            break; // 成功，退出重试循环
          } else if (response.status === 404) {
            // 订单不存在（可能是真的不存在，不是"正在生成"）
            setError("订单不存在");
            break;
          } else {
            // 其他错误，尝试重试
            const errorText = await response.text().catch(() => "Unknown error");
            lastError = new Error(`HTTP ${response.status}: ${errorText}`);
            if (attempt < retryDelays.length - 1) {
              continue; // 继续重试
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.warn(`Failed to fetch reorder URL (attempt ${attempt + 1}):`, error);
          // 如果是最后一次尝试，设置错误信息
          if (attempt === retryDelays.length - 1) {
            setError("获取重新购买链接失败，请稍后刷新页面");
          }
        }
      }

      setIsLoading(false);
    }

    fetchReorderUrl();
  }, [orderId, api, BACKEND_URL, storefrontUrl]);

  // 如果没有订单信息，不显示组件
  if (!orderId && !orderNumber) {
    return null;
  }

  // 如果后端 URL 配置错误，显示错误提示
  if (backendUrlError) {
    return (
      <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
        <Banner status="critical">
          <Text size="small">
            ⚠️ 重新购买服务配置错误，请联系商家
          </Text>
        </Banner>
      </BlockStack>
    );
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

      {error && (
        <Banner status="info">
          <Text size="small">{error}</Text>
        </Banner>
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
          <Button 
            kind="primary" 
            loading={isLoading}
            disabled={isLoading || !reorderUrl}
            onPress={() => {
              // 使用 window.location 进行导航（更兼容，避免 Link 包 Button 的兼容性问题）
              // 如果 window 不可用，尝试使用其他方式
              if (reorderUrl) {
                try {
                  if (typeof window !== "undefined" && window.location) {
                    window.location.href = reorderUrl;
                  } else {
                    // 回退方案：尝试使用 document.location（在某些环境中可用）
                    if (typeof document !== "undefined" && document.location) {
                      document.location.href = reorderUrl;
                    }
                  }
                } catch (error) {
                  console.warn("Failed to navigate to reorder URL:", error);
                }
              }
            }}
          >
            {buttonText}
          </Button>
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

