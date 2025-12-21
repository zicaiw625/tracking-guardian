import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  Pressable,
  Icon,
  useSettings,
  useApi,
} from "@shopify/ui-extensions-react/customer-account";
import { useState, useEffect } from "react";
import { BACKEND_URL } from "../../shared/config";

export default reactExtension(
  "customer-account.order-status.block.render",
  () => <SurveyOrderStatus />
);

function SurveyOrderStatus() {
  const settings = useSettings();
  const api = useApi();
  const backendUrl = BACKEND_URL;
  
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = (settings.survey_title as string) || "我们想听听您的意见";
  const question = (settings.survey_question as string) || "您是如何了解到我们的？";
  
  const shopDomain = api.shop?.myshopifyDomain || "";
  const isDevMode = shopDomain.includes(".myshopify.dev") || 
                    /-(dev|staging|test)\./i.test(shopDomain);

  const sources = [
    { id: "search", label: "搜索引擎" },
    { id: "social", label: "社交媒体" },
    { id: "friend", label: "朋友推荐" },
    { id: "ad", label: "广告" },
    { id: "other", label: "其他" },
  ];

  useEffect(() => {
    async function fetchOrderInfo() {
      try {
        if (api.order) {
          const order = await api.order.current;
          if (order) {
            setOrderId(order.id || null);
            setOrderNumber(order.name || null);
          }
        }
      } catch (err) {
        console.error("Failed to fetch order info:", err);
      }
    }
    fetchOrderInfo();
  }, [api]);

  const handleSubmit = async () => {
    if (selectedRating === null && selectedSource === null) return;
    if (!orderId) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = await api.sessionToken?.get();

      const surveyData = {
        orderId,
        orderNumber,
        rating: selectedRating,
        source: selectedSource,
      };

      const currentShopDomain = api.shop?.myshopifyDomain || "";
      
      if (token && currentShopDomain) {
        const response = await fetch(`${backendUrl}/api/survey`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Shop-Domain": currentShopDomain,
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify(surveyData),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to submit survey");
        }

        if (isDevMode) {
          console.log("Survey submitted successfully from order status page");
        }
      } else {
        console.warn("Survey submission skipped: missing authentication or shop domain");
        throw new Error("Authentication or shop domain not available");
      }

      setSubmitted(true);
    } catch (err) {
      console.error("Survey submission error:", err);
      setError("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <Text size="medium" emphasis="bold">
            感谢您的反馈！
          </Text>
          <Icon source="checkmark" appearance="accent" />
        </InlineLayout>
        <Text size="small" appearance="subdued">
          您的意见对我们非常重要，我们会不断改进服务。
        </Text>
      </BlockStack>
    );
  }

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <Text size="medium" emphasis="bold">
        {title}
      </Text>

      <BlockStack spacing="tight">
        <Text size="small">请为本次购物体验打分：</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto", "auto", "auto"]}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <Pressable key={rating} onPress={() => setSelectedRating(rating)}>
              <View
                padding="extraTight"
                cornerRadius="base"
                background={selectedRating && selectedRating >= rating ? "accent" : "transparent"}
              >
                <Text size="large">
                  {selectedRating && selectedRating >= rating ? "★" : "☆"}
                </Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
      </BlockStack>

      <BlockStack spacing="tight">
        <Text size="small">{question}</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto"]}>
          {sources.slice(0, 3).map((source) => (
            <Pressable key={source.id} onPress={() => setSelectedSource(source.id)}>
              <View
                padding="tight"
                cornerRadius="base"
                border={selectedSource === source.id ? "accent" : "base"}
                background={selectedSource === source.id ? "accent" : "transparent"}
              >
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
        <InlineLayout spacing="tight" columns={["auto", "auto"]}>
          {sources.slice(3).map((source) => (
            <Pressable key={source.id} onPress={() => setSelectedSource(source.id)}>
              <View
                padding="tight"
                cornerRadius="base"
                border={selectedSource === source.id ? "accent" : "base"}
                background={selectedSource === source.id ? "accent" : "transparent"}
              >
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>
          ))}
        </InlineLayout>
      </BlockStack>

      {error && (
        <View padding="tight" background="critical" cornerRadius="base">
          <Text size="small" appearance="critical">
            {error}
          </Text>
        </View>
      )}

      <Button
        kind="secondary"
        onPress={handleSubmit}
        disabled={(selectedRating === null && selectedSource === null) || submitting || !orderId}
        loading={submitting}
      >
        {submitting ? "提交中..." : "提交反馈"}
      </Button>
    </BlockStack>
  );
}
