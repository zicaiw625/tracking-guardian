

import {
    reactExtension,
    BlockStack,
    Text,
    InlineLayout,
    View,
    Icon,
    useSettings,
    useApi,
    Divider,
    Button,
    Banner,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";
import { BACKEND_URL, isAllowedBackendUrl } from "../../shared/config";

export default reactExtension("purchase.thank-you.block.render", () => <ShippingTracker />);

const ShippingTracker = memo(function ShippingTracker() {
    const settings = useSettings();
    const api = useApi();
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderNumber, setOrderNumber] = useState<string | null>(null);
    const [trackingInfo, setTrackingInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [backendUrlError, setBackendUrlError] = useState(false);

    const title = useMemo(() => (settings.shipping_title as string) || "订单状态", [settings.shipping_title]);
    const tipText = useMemo(() => (settings.shipping_tip_text as string) ||
        "发货后您将收到包含物流追踪信息的邮件通知。如有任何问题，请随时联系我们的客服团队。", [settings.shipping_tip_text]);

    
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

    useEffect(() => {
        async function fetchTrackingInfo() {
            
            if (!orderId) {
                return;
            }
            
            if (!BACKEND_URL || !isAllowedBackendUrl(BACKEND_URL)) {
                console.warn("ShippingTracker: Backend URL not configured or not allowed", { BACKEND_URL });
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

                    
                    
                    const response = await fetch(`${BACKEND_URL}/api/tracking?orderId=${encodeURIComponent(orderId)}`, {
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
                            console.log(`Order still creating, retrying after ${retryDelay}ms`, { orderId, attempt });
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            continue;
                        } else {
                            
                            setError(data.message || "订单正在生成，请稍后刷新页面查看物流信息");
                            break;
                        }
                    }

                    if (response.ok) {
                        const data = await response.json();
                        
                        if (data.tracking) {
                            setTrackingInfo({
                                trackingNumber: data.tracking.trackingNumber,
                                carrier: data.tracking.carrier,
                                status: data.tracking.status,
                                statusDescription: data.tracking.statusDescription,
                                estimatedDelivery: data.tracking.estimatedDelivery ? new Date(data.tracking.estimatedDelivery) : undefined,
                                events: data.tracking.events || [],
                            });
                            setError(null);
                            break; 
                        }
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
                    console.warn(`Failed to fetch tracking info (attempt ${attempt + 1}):`, error);
                    
                    if (attempt === retryDelays.length - 1) {
                        setError("获取物流信息失败，请稍后刷新页面");
                    }
                }
            }
            
            setIsLoading(false);
        }
        
        fetchTrackingInfo();
    }, [orderId, api, BACKEND_URL]);

    const shippingSteps = useMemo(() => {
        if (trackingInfo) {
            const status = trackingInfo.status;
            
            const isPending = status === "pending" || status === "pending_fulfillment";
            return [
                { id: "ordered", label: "订单已确认", completed: true, date: "已完成" },
                { id: "processing", label: "处理中", completed: !isPending, date: !isPending ? "进行中" : "待处理" },
                { id: "shipped", label: "已发货", completed: status === "in_transit" || status === "delivered", date: status === "in_transit" || status === "delivered" ? "已发货" : "待发货" },
                { id: "delivered", label: "已送达", completed: status === "delivered", date: status === "delivered" ? "已送达" : "待送达" },
            ];
        }

        return [
            { id: "ordered", label: "订单已确认", completed: true, date: "已完成" },
            { id: "processing", label: "处理中", completed: true, date: "进行中" },
            { id: "shipped", label: "已发货", completed: false, date: "待发货" },
            { id: "delivered", label: "已送达", completed: false, date: "待送达" },
        ];
    }, [trackingInfo]);

    const confirmationNumber = useMemo(() => orderNumber || "处理中...", [orderNumber]);
    const trackingNumber = useMemo(() => trackingInfo?.trackingNumber || "", [trackingInfo]);

    
    if (backendUrlError) {
        return (
            <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
                <Banner status="critical">
                    <Text size="small">
                        ⚠️ 物流追踪服务配置错误，请联系商家
                    </Text>
                </Banner>
            </BlockStack>
        );
    }

    return (
        <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
            <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                <Text size="medium" emphasis="bold">
                    📦 {title}
                </Text>
                <Icon source="delivery" />
            </InlineLayout>

            <Divider />
            
            {error && (
                <Banner status="info">
                    <Text size="small">{error}</Text>
                </Banner>
            )}

            <BlockStack spacing="tight">
                {shippingSteps.map((step, index) => (
                    <InlineLayout
                        key={step.id}
                        columns={["auto", "fill", "auto"]}
                        spacing="base"
                        blockAlignment="center"
                    >
                        <View
                            padding="extraTight"
                            cornerRadius="fullyRounded"
                            background={step.completed ? "accent" : "subdued"}
                        >
                            <Text size="small">
                                {step.completed ? "✓" : (index + 1).toString()}
                            </Text>
                        </View>
                        <BlockStack spacing="none">
                            <Text
                                size="small"
                                emphasis={step.completed ? "bold" : undefined}
                                appearance={step.completed ? undefined : "subdued"}
                            >
                                {step.label}
                            </Text>
                        </BlockStack>
                        <Text size="small" appearance="subdued">
                            {step.date}
                        </Text>
                    </InlineLayout>
                ))}
            </BlockStack>

            <Divider />

            <BlockStack spacing="tight">
                <InlineLayout columns={["fill", "auto"]} spacing="base">
                    <Text size="small" appearance="subdued">
                        订单编号
                    </Text>
                    <Text size="small" emphasis="bold">
                        {confirmationNumber}
                    </Text>
                </InlineLayout>
                        {trackingInfo?.trackingNumber && (
                            <InlineLayout columns={["fill", "auto"]} spacing="base">
                                <Text size="small" appearance="subdued">
                                    物流单号
                                </Text>
                                <Text size="small" emphasis="bold">
                                    {trackingInfo.trackingNumber}
                                </Text>
                            </InlineLayout>
                        )}
                {trackingInfo?.estimatedDelivery && (
                    <InlineLayout columns={["fill", "auto"]} spacing="base">
                        <Text size="small" appearance="subdued">
                            预计送达
                        </Text>
                        <Text size="small" emphasis="bold">
                            {new Date(trackingInfo.estimatedDelivery).toLocaleDateString()}
                        </Text>
                    </InlineLayout>
                )}
                {trackingInfo?.status === "pending_fulfillment" && trackingInfo?.statusDescription && (
                    <InlineLayout columns={["fill", "auto"]} spacing="base">
                        <Text size="small" appearance="subdued">
                            状态说明
                        </Text>
                        <Text size="small" emphasis="bold">
                            {trackingInfo.statusDescription}
                        </Text>
                    </InlineLayout>
                )}
            </BlockStack>

            <View padding="tight" background="subdued" cornerRadius="base">
                <BlockStack spacing="extraTight">
                    <Text size="small" appearance="subdued">
                        💡 小提示
                    </Text>
                    <Text size="small" appearance="subdued">
                        {tipText}
                    </Text>
                </BlockStack>
            </View>
        </BlockStack>
    );
});
