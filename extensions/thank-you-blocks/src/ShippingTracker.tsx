

import {
    reactExtension,
    BlockStack,
    Text,
    InlineLayout,
    View,
    Icon,
    useSettings,
    useOrder,
    useApi,
    Divider,
    Button,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";
import { BACKEND_URL } from "../../shared/config";

export default reactExtension("purchase.thank-you.block.render", () => <ShippingTracker />);

const ShippingTracker = memo(function ShippingTracker() {
    const settings = useSettings();
    const api = useApi();
    const [orderId, setOrderId] = useState<string | null>(null);
    const [orderNumber, setOrderNumber] = useState<string | null>(null);
    const [trackingInfo, setTrackingInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    const title = useMemo(() => (settings.shipping_title as string) || "订单状态", [settings.shipping_title]);
    const tipText = useMemo(() => (settings.shipping_tip_text as string) ||
        "发货后您将收到包含物流追踪信息的邮件通知。如有任何问题，请随时联系我们的客服团队。", [settings.shipping_tip_text]);

    const provider = useMemo(() => (settings.tracking_provider as string) || "native", [settings.tracking_provider]);

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
            if (provider !== "native" && orderId && BACKEND_URL) {
                setIsLoading(true);
                try {
                    const token = await api.sessionToken.get();
                    const shopDomain = api.shop?.myshopifyDomain || "";

                    if (shopDomain && token) {
                        // 通过后端 API 获取物流信息（后端会从 Shopify Admin API 获取）
                        const response = await fetch(`${BACKEND_URL}/api/tracking?orderId=${encodeURIComponent(orderId)}&trackingNumber=`, {
                            headers: {
                                "Content-Type": "application/json",
                                "X-Shopify-Shop-Domain": shopDomain,
                                "Authorization": `Bearer ${token}`,
                            },
                        });

                        if (response.ok) {
                            const data = await response.json();
                            if (data.tracking) {
                                setTrackingInfo({
                                    trackingNumber: data.tracking.trackingNumber,
                                    carrier: data.tracking.carrier,
                                    status: data.tracking.status,
                                    estimatedDelivery: data.tracking.estimatedDelivery ? new Date(data.tracking.estimatedDelivery) : undefined,
                                    events: data.tracking.events || [],
                                });
                            }
                        }
                    }
                } catch (error) {
                    console.warn("Failed to fetch tracking info:", error);
                } finally {
                    setIsLoading(false);
                }
            }
        }
        fetchTrackingInfo();
    }, [provider, orderId, api, BACKEND_URL]);

    const shippingSteps = useMemo(() => {
        if (trackingInfo) {

            const status = trackingInfo.status;
            return [
                { id: "ordered", label: "订单已确认", completed: true, date: "已完成" },
                { id: "processing", label: "处理中", completed: status !== "pending", date: status !== "pending" ? "进行中" : "待处理" },
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

    return (
        <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
            <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                <Text size="medium" emphasis="bold">
                    📦 {title}
                </Text>
                <Icon source="delivery" />
            </InlineLayout>

            <Divider />

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
            </BlockStack>

            {}

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
