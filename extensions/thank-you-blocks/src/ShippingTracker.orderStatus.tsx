

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
} from "@shopify/ui-extensions-react/customer-account";

export default reactExtension(
    "customer-account.order-status.block.render",
    () => <ShippingTrackerOrderStatus />
);

function ShippingTrackerOrderStatus() {
    const settings = useSettings();
    const order = useOrder();

    const title = (settings.shipping_title as string) || "订单状态";
    const tipText = (settings.shipping_tip_text as string) ||
        "发货后您将收到包含物流追踪信息的邮件通知。如有任何问题，请随时联系我们的客服团队。";

    const orderStatus = (order && 'status' in order && typeof order.status === 'string')
      ? order.status
      : "UNFULFILLED";

    const getProgressFromStatus = (status: string) => {
        switch (status) {
            case "FULFILLED":
                return { ordered: true, processing: true, shipped: true, delivered: false };
            case "PARTIALLY_FULFILLED":
                return { ordered: true, processing: true, shipped: false, delivered: false };
            case "UNFULFILLED":
            default:
                return { ordered: true, processing: true, shipped: false, delivered: false };
        }
    };

    const progress = getProgressFromStatus(orderStatus);

    const shippingSteps = [
        {
            id: "ordered",
            label: "订单已确认",
            completed: progress.ordered,
            date: "已完成"
        },
        {
            id: "processing",
            label: "处理中",
            completed: progress.processing,
            date: progress.processing ? "进行中" : "待处理"
        },
        {
            id: "shipped",
            label: "已发货",
            completed: progress.shipped,
            date: progress.shipped ? "已发货" : "待发货"
        },
        {
            id: "delivered",
            label: "已送达",
            completed: progress.delivered,
            date: progress.delivered ? "已送达" : "待送达"
        },
    ];

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
                        {order?.name || "加载中..."}
                    </Text>
                </InlineLayout>
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
}

