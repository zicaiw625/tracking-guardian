import { reactExtension, BlockStack, Text, Button, InlineLayout, View, Pressable, Icon, useSettings, useApi, Banner, } from "@shopify/ui-extensions-react/checkout";
import { useState, useEffect, useMemo, useCallback, memo } from "react";
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";
import { createLogger } from "./logger";

export default reactExtension("purchase.thank-you.block.render", () => <Survey />);
const Survey = memo(function Survey() {
    const settings = useSettings();

    const backendUrl = BACKEND_URL;
    const api = useApi();
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderNumber, setOrderNumber] = useState<string | null>(null);
    const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
    const [selectedRating, setSelectedRating] = useState<number | null>(null);
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [selectedSource, setSelectedSource] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const title = useMemo(() => (settings.survey_title as string) || "我们想听听您的意见", [settings.survey_title]);
    const question = useMemo(() => (settings.survey_question as string) || "您是如何了解到我们的？", [settings.survey_question]);
    const isBackendConfigured = useMemo(() => !!backendUrl, [backendUrl]);
    const shopDomain = useMemo(() => api.shop?.myshopifyDomain || "", [api.shop?.myshopifyDomain]);
    const logger = useMemo(() => createLogger(shopDomain, "[Survey]"), [shopDomain]);
    const [backendUrlError, setBackendUrlError] = useState(false);

    useEffect(() => {
        async function fetchOrderAndCheckoutInfo() {
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

                if (api.checkoutToken) {
                    let tokenValue = api.checkoutToken;

                    if (typeof tokenValue === 'object' && tokenValue !== null && 'current' in tokenValue) {
                        tokenValue = (tokenValue as { current: unknown }).current;
                    }

                    if (typeof tokenValue === 'string') {
                        setCheckoutToken(tokenValue);
                    } else if (tokenValue && typeof tokenValue === 'object' && 'value' in tokenValue) {
                        const valueObj = tokenValue as { value: string };
                        setCheckoutToken(valueObj.value || null);
                    }
                }
            }
            catch (err) {
                logger.error("Failed to get order/checkout info:", err);
            }
        }
        fetchOrderAndCheckoutInfo();
    }, [api, logger]);

    const sources = useMemo(() => [
        { id: "search", label: "搜索引擎" },
        { id: "social", label: "社交媒体" },
        { id: "friend", label: "朋友推荐" },
        { id: "ad", label: "广告" },
        { id: "other", label: "其他" },
    ], []);

    const handleSubmit = useCallback(async () => {
        if (selectedRating === null && selectedSource === null)
            return;
        if (!orderId && !orderNumber && !checkoutToken) {
            logger.warn("No order identifiers available");
            return;
        }

        if (!backendUrl || !isAllowedBackendUrl(backendUrl)) {
            logger.warn("Backend URL not configured or not allowed, cannot submit survey");
            setBackendUrlError(true);
            setError("服务暂时不可用，请稍后再试");
            return;
        }
        setBackendUrlError(false);
        setSubmitting(true);
        setError(null);
        try {
            const token = await api.sessionToken.get();
            const surveyData = {
                orderId: orderId || undefined,
                orderNumber: orderNumber || undefined,
                checkoutToken: checkoutToken || undefined,
                rating: selectedRating,
                source: selectedSource,
            };
            const currentShopDomain = api.shop?.myshopifyDomain || "";
            if (currentShopDomain) {
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
                logger.log("Survey submitted successfully", {
                    hasCheckoutToken: !!checkoutToken,
                    hasOrderId: !!orderId
                });
            }
            else {
                logger.warn("Survey submission skipped: shop domain not available");
                throw new Error("Shop domain not available");
            }
            setSubmitted(true);
        }
        catch (err) {
            logger.error("Survey submission error:", err);
            setError("提交失败，请稍后重试");
        }
        finally {
            setSubmitting(false);
        }
    }, [selectedRating, selectedSource, orderId, orderNumber, checkoutToken, backendUrl, api, logger]);

    const handleRatingSelect = useCallback((rating: number) => {
        setSelectedRating(rating);
    }, []);

    const handleSourceSelect = useCallback((sourceId: string) => {
        setSelectedSource(sourceId);
    }, []);

    const canSubmit = useMemo(() => {
        return (selectedRating !== null || selectedSource !== null) &&
               (orderId || orderNumber || checkoutToken) &&
               !submitting;
    }, [selectedRating, selectedSource, orderId, orderNumber, checkoutToken, submitting]);
    if (submitted) {
        return (<BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
        <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
          <Text size="medium" emphasis="bold">
            感谢您的反馈！
          </Text>
          <Icon source="checkmark" appearance="accent"/>
        </InlineLayout>
        <Text size="small" appearance="subdued">
          您的意见对我们非常重要，我们会不断改进服务。
        </Text>
      </BlockStack>);
    }

    if (backendUrlError) {
        return (
            <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
                <Banner status="critical">
                    <Text size="small">
                        ⚠️ 反馈服务配置错误，请联系商家
                    </Text>
                </Banner>
            </BlockStack>
        );
    }

    return (<BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <Text size="medium" emphasis="bold">
        {title}
      </Text>

      <BlockStack spacing="tight">
        <Text size="small">请为本次购物体验打分：</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto", "auto", "auto"]}>
          {[1, 2, 3, 4, 5].map((rating) => (<Pressable key={rating} onPress={() => handleRatingSelect(rating)}>
              <View padding="extraTight" cornerRadius="base" background={selectedRating && selectedRating >= rating ? "accent" : "transparent"}>
                <Text size="large">
                  {selectedRating && selectedRating >= rating ? "★" : "☆"}
                </Text>
              </View>
            </Pressable>))}
        </InlineLayout>
      </BlockStack>

      <BlockStack spacing="tight">
        <Text size="small">{question}</Text>
        <InlineLayout spacing="tight" columns={["auto", "auto", "auto"]}>
          {sources.slice(0, 3).map((source) => (<Pressable key={source.id} onPress={() => handleSourceSelect(source.id)}>
              <View padding="tight" cornerRadius="base" border={selectedSource === source.id ? "accent" : "base"} background={selectedSource === source.id ? "accent" : "transparent"}>
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>))}
        </InlineLayout>
        <InlineLayout spacing="tight" columns={["auto", "auto"]}>
          {sources.slice(3).map((source) => (<Pressable key={source.id} onPress={() => handleSourceSelect(source.id)}>
              <View padding="tight" cornerRadius="base" border={selectedSource === source.id ? "accent" : "base"} background={selectedSource === source.id ? "accent" : "transparent"}>
                <Text size="small">{source.label}</Text>
              </View>
            </Pressable>))}
        </InlineLayout>
      </BlockStack>

      {error && (<View padding="tight" background="critical" cornerRadius="base">
          <Text size="small" appearance="critical">
            {error}
          </Text>
        </View>)}

      <Button kind="secondary" onPress={handleSubmit} disabled={!canSubmit} loading={submitting}>
        {submitting ? "提交中..." : "提交反馈"}
      </Button>
    </BlockStack>);
});
