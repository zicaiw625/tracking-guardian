

import {
    reactExtension,
    BlockStack,
    Text,
    Button,
    InlineLayout,
    View,
    useSettings,
    useOrder,
    Divider,
    Banner,
    Link,
} from "@shopify/ui-extensions-react/customer-account";
import { useState } from "react";

export default reactExtension(
    "customer-account.order-status.block.render",
    () => <UpsellOfferOrderStatus />
);

function UpsellOfferOrderStatus() {
    const settings = useSettings();
    const order = useOrder();
    const [dismissed, setDismissed] = useState(false);
    const [copied, setCopied] = useState(false);

    const discountCode = (settings.upsell_discount_code as string) || "THANKYOU10";
    const discountPercentStr = settings.upsell_discount_percent as string;
    const discountPercent = discountPercentStr ? parseInt(discountPercentStr, 10) : 10;
    const expiryHoursStr = settings.upsell_expiry_hours as string;
    const expiryHours = expiryHoursStr ? parseInt(expiryHoursStr, 10) : 24;
    
    
    
    
    const continueShoppingUrl = (() => {
      const url = (settings.continue_shopping_url as string) || "/";
      
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
      }
      
      return url;
    })();

    const handleCopyCode = () => {

        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (dismissed) {
        return null;
    }

    return (
        <BlockStack spacing="base" padding="base" border="base" cornerRadius="base">
            <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                <Text size="medium" emphasis="bold">
                    🎁 专属感谢优惠
                </Text>
                <Button kind="plain" onPress={() => setDismissed(true)}>
                    ✕
                </Button>
            </InlineLayout>

            <Banner status="success">
                <BlockStack spacing="extraTight">
                    <Text size="medium" emphasis="bold">
                        下次购物立减 {discountPercent}%
                    </Text>
                    <Text size="small">
                        感谢您的订单！使用以下优惠码享受下次购物折扣
                    </Text>
                </BlockStack>
            </Banner>

            <View padding="base" background="subdued" cornerRadius="base">
                <InlineLayout columns={["fill", "auto"]} spacing="base" blockAlignment="center">
                    <BlockStack spacing="none">
                        <Text size="small" appearance="subdued">
                            优惠码
                        </Text>
                        <Text size="large" emphasis="bold">
                            {discountCode}
                        </Text>
                    </BlockStack>
                    <Button kind="secondary" onPress={handleCopyCode}>
                        {copied ? "已复制 ✓" : "复制"}
                    </Button>
                </InlineLayout>
            </View>

            <BlockStack spacing="tight">
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">⏰</Text>
                    <Text size="small" appearance="subdued">
                        优惠码有效期 {expiryHours} 小时
                    </Text>
                </InlineLayout>
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">💳</Text>
                    <Text size="small" appearance="subdued">
                        可与其他优惠叠加使用
                    </Text>
                </InlineLayout>
                <InlineLayout columns={["auto", "fill"]} spacing="tight" blockAlignment="center">
                    <Text size="small">🔒</Text>
                    <Text size="small" appearance="subdued">
                        每个账户仅限使用一次
                    </Text>
                </InlineLayout>
            </BlockStack>

            <Divider />

            <Link to={continueShoppingUrl}>
                <Button kind="primary">
                    继续购物 →
                </Button>
            </Link>
        </BlockStack>
    );
}

