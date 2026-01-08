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
  Link,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";
import { BACKEND_URL, isAllowedBackendUrl } from "./config";
import { getLocalizedText } from "./localization";

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

  const storefrontUrl = useMemo(() => {
    return api.shop?.storefrontUrl || "";
  }, [api.shop?.storefrontUrl]);

  const title = useMemo(() =>
    getLocalizedText(settings, "reorder_title", "📦 再次购买", undefined, api as { locale?: string }),
    [settings, api]
  );
  const subtitle = useMemo(() =>
    getLocalizedText(settings, "reorder_subtitle", "喜欢这次购物？一键再次订购相同商品", undefined, api as { locale?: string }),
    [settings, api]
  );
  const buttonText = useMemo(() =>
    getLocalizedText(settings, "reorder_button_text", "再次购买 →", undefined, api as { locale?: string }),
    [settings, api]
  );

  useEffect(() => {
    async function fetchOrderInfo() {
      try {

        if ('orderConfirmation' in api && api.orderConfirmation) {
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

      }
    }
    fetchOrderInfo();
  }, [api]);

  useEffect(() => {
    async function fetchReorderUrl() {
      if (!orderId) {
        return;
      }

      if (!BACKEND_URL || !isAllowedBackendUrl(BACKEND_URL)) {
        setBackendUrlError(true);
        setError("后端服务配置错误，请联系商家");
        return;
      }

      setBackendUrlError(false);
      setError(null);
      setIsLoading(true);

      const retryDelays = [0, 500, 1500, 3000];
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        try {

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

          if (response.status === 202) {
            const data = await response.json();
            const retryAfter = response.headers.get("Retry-After");
            const retryDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000;

            if (attempt < retryDelays.length - 1) {
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              continue;
            } else {

              setError(data.message || "订单正在生成，请稍后刷新页面");
              break;
            }
          }

          if (response.ok) {
            const data = await response.json();

            const reorderUrlFromBackend = data.reorderUrl || "/cart";

            const absoluteUrl = reorderUrlFromBackend.startsWith("http://") || reorderUrlFromBackend.startsWith("https://")
              ? reorderUrlFromBackend
              : (storefrontUrl
                  ? `${storefrontUrl}${reorderUrlFromBackend.startsWith("/") ? reorderUrlFromBackend : `/${reorderUrlFromBackend}`}`
                  : reorderUrlFromBackend);
            setReorderUrl(absoluteUrl);
            setError(null);
            break;
          } else if (response.status === 404) {

            setError("订单不存在");
            break;
          } else {

            const errorText = await response.text().catch(() => "Unknown error");
            lastError = new Error(`HTTP ${response.status}: ${errorText}`);
            if (attempt < retryDelays.length - 1) {
              continue;
            }
          }
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt === retryDelays.length - 1) {

            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes("fetch") || errorMessage.includes("network") || errorMessage.includes("Failed to fetch")) {
              setError("网络连接失败，请稍后刷新页面重试");
            } else {
              setError("获取重新购买链接失败，请稍后刷新页面");
            }
          }
        }
      }

      setIsLoading(false);
    }

    fetchReorderUrl();
  }, [orderId, api, BACKEND_URL, storefrontUrl]);

  if (!orderId && !orderNumber) {
    return null;
  }

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
          {reorderUrl ? (
            <Link to={reorderUrl}>
              <Button
                kind="primary"
                loading={isLoading}
                disabled={isLoading}
              >
                {buttonText}
              </Button>
            </Link>
          ) : (
            <Button
              kind="primary"
              loading={isLoading}
              disabled={true}
            >
              {buttonText}
            </Button>
          )}
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
