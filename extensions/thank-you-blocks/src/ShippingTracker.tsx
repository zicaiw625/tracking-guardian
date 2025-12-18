import {
  reactExtension,
  BlockStack,
  Text,
  Button,
  InlineLayout,
  View,
  Icon,
  useSettings,
  useOrder,
  Link,
  Divider,
} from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.thank-you.block.render",
  () => <ShippingTracker />
);

function ShippingTracker() {
  const settings = useSettings();
  const order = useOrder();

  // Get tracking info from order (this would come from fulfillment data)
  const trackingNumber = order?.confirmationNumber || ""; // Placeholder
  const trackingUrl = settings.tracking_provider_url
    ? (settings.tracking_provider_url as string).replace("{tracking_number}", trackingNumber)
    : `https://t.17track.net/en#nums=${trackingNumber}`;

  // Simulated shipping status
  const shippingSteps = [
    { id: "ordered", label: "订单已确认", completed: true, date: "今天" },
    { id: "processing", label: "处理中", completed: true, date: "预计 1-2 天" },
    { id: "shipped", label: "已发货", completed: false, date: "预计 2-3 天" },
    { id: "delivered", label: "已送达", completed: false, date: "预计 5-7 天" },
  ];

  return (
    <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
      <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
        <Text size="medium" emphasis="bold">
          📦 物流追踪
        </Text>
        <Icon source="delivery" />
      </InlineLayout>

      <Divider />

      {/* Shipping Progress */}
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

      {/* Tracking Number & Link */}
      <BlockStack spacing="tight">
        <InlineLayout columns={["fill", "auto"]} spacing="base">
          <Text size="small" appearance="subdued">
            订单号
          </Text>
          <Text size="small" emphasis="bold">
            {order?.confirmationNumber || "处理中..."}
          </Text>
        </InlineLayout>
      </BlockStack>

      {trackingNumber && (
        <Link to={trackingUrl} external>
          <Button kind="secondary">
            查看详细物流信息 →
          </Button>
        </Link>
      )}

      {/* Helpful Info */}
      <View padding="tight" background="subdued" cornerRadius="base">
        <BlockStack spacing="extraTight">
          <Text size="small" appearance="subdued">
            💡 小提示
          </Text>
          <Text size="small" appearance="subdued">
            发货后您将收到包含物流追踪号的邮件通知。
            如有任何问题，请随时联系我们的客服团队。
          </Text>
        </BlockStack>
      </View>
    </BlockStack>
  );
}

