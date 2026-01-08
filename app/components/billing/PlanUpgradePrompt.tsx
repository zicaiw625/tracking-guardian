import {
  Modal,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  List,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { BILLING_PLANS, type PlanId } from "~/services/billing/plans";

interface PlanUpgradePromptProps {
  open: boolean;
  onClose: () => void;
  currentPlan: PlanId;
  targetPlan: PlanId;
  featureName: string;
  currentUsage?: number;
  limit?: number;
  onUpgrade: () => void;
}

export function PlanUpgradePrompt({
  open,
  onClose,
  currentPlan,
  targetPlan,
  featureName: _featureName,
  currentUsage,
  limit,
  onUpgrade,
}: PlanUpgradePromptProps) {
  const currentPlanInfo = BILLING_PLANS[currentPlan];
  const targetPlanInfo = BILLING_PLANS[targetPlan];

  const usageText = currentUsage !== undefined && limit !== undefined
    ? `当前使用: ${currentUsage} / ${limit}`
    : "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="需要升级套餐"
      primaryAction={{
        content: `升级到 ${targetPlanInfo.name}`,
        onAction: onUpgrade,
      }}
      secondaryActions={[
        {
          content: "稍后再说",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p">
            您当前使用的 <strong>{currentPlanInfo.name}</strong> 套餐不支持此功能。
          </Text>

          {usageText && (
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {usageText}
              </Text>
            </Box>
          )}

          <Divider />

          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">
              功能对比
            </Text>

            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {currentPlanInfo.name}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {currentPlanInfo.price}
                  </Text>
                </BlockStack>
                <BlockStack gap="100" align="end">
                  <Badge tone="info">当前</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {currentPlanInfo.pixelDestinations === -1
                      ? "无限制"
                      : `${currentPlanInfo.pixelDestinations} 个平台`}
                  </Text>
                </BlockStack>
              </InlineStack>

              <Divider />

              <InlineStack align="space-between" blockAlign="start">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {targetPlanInfo.name}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {targetPlanInfo.price}
                  </Text>
                </BlockStack>
                <BlockStack gap="100" align="end">
                  <Badge tone="success">推荐</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {targetPlanInfo.pixelDestinations === -1
                      ? "无限制"
                      : `${targetPlanInfo.pixelDestinations} 个平台`}
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </BlockStack>

          <Divider />

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              升级后您将获得：
            </Text>
            <List>
              {targetPlanInfo.features.map((feature, index) => (
                <List.Item key={index}>
                  <InlineStack gap="200" blockAlign="center">
                    <CheckCircleIcon />
                    <Text as="span" variant="bodySm">{feature}</Text>
                  </InlineStack>
                </List.Item>
              ))}
            </List>
          </BlockStack>

          <Banner tone="info">
            <Text as="p" variant="bodySm">
              升级后立即生效，无需等待。您可以随时在设置页面管理您的套餐。
            </Text>
          </Banner>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
