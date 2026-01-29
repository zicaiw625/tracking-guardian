import { reactExtension, Banner, Text } from "@shopify/ui-extensions-react/customer-account";

export default reactExtension(
  "customer-account.order-status.customer-information.render-after",
  () => {
    return (
      <Banner title="Tracking Guardian">
        <Text>追踪状态：正常（如有异常会在后台提示）。</Text>
      </Banner>
    );
  }
);
