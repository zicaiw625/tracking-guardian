

import {
    reactExtension,
    BlockStack,
    Text,
    InlineLayout,
    View,
    Icon,
    useSettings,
    useOrder,
    Divider,
    Button,
} from "@shopify/ui-extensions-react/checkout";
import { useMemo, memo, useState, useEffect } from "react";

export default reactExtension("purchase.thank-you.block.render", () => <ShippingTracker />);

const ShippingTracker = memo(function ShippingTracker() {
    const settings = useSettings();
    const order = useOrder();
    const [trackingInfo, setTrackingInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);

    const title = useMemo(() => (settings.shipping_title as string) || "订单状态", [settings.shipping_title]);
    const tipText = useMemo(() => (settings.shipping_tip_text as string) ||
        "发货后您将收到包含物流追踪信息的邮件通知。如有任何问题，请随时联系我们的客服团队。", [settings.shipping_tip_text]);

    const provider = useMemo(() => (settings.tracking_provider as string) || "native", [settings.tracking_provider]);

    // 获取追踪信息
    useEffect(() => {
        if (provider !== "native" && order?.id) {
            setIsLoading(true);
            // 从后端 API 获取追踪信息
            // 注意：在 UI Extension 中，我们需要通过后端 API 获取追踪信息
            // 这里简化处理，实际应该调用后端 API
            setIsLoading(false);
        }
    }, [provider, order?.id]);

    // 根据订单状态和追踪信息生成步骤
    const shippingSteps = useMemo(() => {
        if (trackingInfo) {
            // 如果有追踪信息，使用追踪信息生成步骤
            const status = trackingInfo.status;
            return [
                { id: "ordered", label: "订单已确认", completed: true, date: "已完成" },
                { id: "processing", label: "处理中", completed: status !== "pending", date: status !== "pending" ? "进行中" : "待处理" },
                { id: "shipped", label: "已发货", completed: status === "in_transit" || status === "delivered", date: status === "in_transit" || status === "delivered" ? "已发货" : "待发货" },
                { id: "delivered", label: "已送达", completed: status === "delivered", date: status === "delivered" ? "已送达" : "待送达" },
            ];
        }

        // 默认步骤（基于订单状态）
        return [
            { id: "ordered", label: "订单已确认", completed: true, date: "已完成" },
            { id: "processing", label: "处理中", completed: true, date: "进行中" },
            { id: "shipped", label: "已发货", completed: false, date: "待发货" },
            { id: "delivered", label: "已送达", completed: false, date: "待送达" },
        ];
    }, [trackingInfo]);

    const confirmationNumber = useMemo(() => order?.confirmationNumber || "处理中...", [order?.confirmationNumber]);
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
                {trackingNumber && (
                    <InlineLayout columns={["fill", "auto"]} spacing="base">
                        <Text size="small" appearance="subdued">
                            物流单号
                        </Text>
                        <Text size="small" emphasis="bold">
                            {trackingNumber}
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
