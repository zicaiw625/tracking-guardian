import { reactExtension, Banner, Text } from "@shopify/ui-extensions-react/checkout";

export default reactExtension(
  "purchase.thank-you.customer-information.render-after",
  () => {
    return (
      <Banner title="Tracking Guardian">
        <Text>本次订单追踪已启用（尊重客户同意设置）。</Text>
      </Banner>
    );
  }
);
