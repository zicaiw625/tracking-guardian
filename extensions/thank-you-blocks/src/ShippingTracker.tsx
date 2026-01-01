

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
            // 安全检查：确保 BACKEND_URL 是允许的域名，防止 token 外泄
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

                    // 通过后端 API 获取物流信息（后端会从 Shopify Admin API 获取，并根据配置调用第三方）
                    // 只传 orderId，后端会从 Shopify fulfillments 中获取 trackingNumber
                    const response = await fetch(`${BACKEND_URL}/api/tracking?orderId=${encodeURIComponent(orderId)}`, {
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
                            setError(data.message || "订单正在生成，请稍后刷新页面查看物流信息");
                            break;
                        }
                    }

                    if (response.ok) {
                        const data = await response.json();
                        // 处理 pending_fulfillment 状态（暂未生成物流信息）
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
                            break; // 成功，退出重试循环
                        }
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
                    console.warn(`Failed to fetch tracking info (attempt ${attempt + 1}):`, error);
                    // 如果是最后一次尝试，设置错误信息
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
            // 处理 pending_fulfillment 状态（暂未生成物流信息）
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

    // 如果后端 URL 配置错误，显示错误提示
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
