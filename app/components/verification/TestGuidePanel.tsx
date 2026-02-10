import { Card, BlockStack, InlineStack, Button, Box, Divider, List, Text, Collapsible, Badge } from "@shopify/polaris";
import { ClipboardIcon } from "~/components/icons";
import { PlatformBadge } from "./VerificationBadges";

export interface TestGuideStep {
  step: number;
  title: string;
  description: string;
}

export interface TestGuideData {
  steps: TestGuideStep[];
  tips: string[];
  estimatedTime: string;
}

export interface TestGuidePanelProps {
  testGuide: TestGuideData;
  configuredPlatforms: string[];
  onCopyGuide: () => void;
  guideExpanded: boolean;
  onGuideExpandedChange: (expanded: boolean) => void;
}

export function TestGuidePanel({
  testGuide,
  configuredPlatforms,
  onCopyGuide,
  guideExpanded,
  onGuideExpandedChange,
}: TestGuidePanelProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            📋 测试订单指引
          </Text>
          <InlineStack gap="200">
            <Button icon={ClipboardIcon} onClick={onCopyGuide} size="slim">
              复制指引
            </Button>
            <Button
              onClick={() => onGuideExpandedChange(!guideExpanded)}
              size="slim"
              variant="plain"
            >
              {guideExpanded ? "收起" : "展开"}
            </Button>
          </InlineStack>
        </InlineStack>
        <Collapsible open={guideExpanded} id="guide-collapsible">
          <BlockStack gap="300">
            <InlineStack gap="200">
              <Badge tone="info">{`预计时间: ${testGuide.estimatedTime}`}</Badge>
              {configuredPlatforms.map((p) => (
                <PlatformBadge key={p} platform={p} />
              ))}
            </InlineStack>
            <Divider />
            <BlockStack gap="300">
              {testGuide.steps.map((step) => (
                <Box
                  key={step.step}
                  background="bg-surface-secondary"
                  padding="300"
                  borderRadius="100"
                >
                  <InlineStack gap="300" blockAlign="start">
                    <Box
                      background="bg-fill-info"
                      padding="100"
                      borderRadius="full"
                      minWidth="24px"
                    >
                      <Text as="span" variant="bodySm" fontWeight="bold" alignment="center">
                        {step.step}
                      </Text>
                    </Box>
                    <BlockStack gap="100">
                      <Text as="span" fontWeight="semibold">
                        {step.title}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {step.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
            <Divider />
            <BlockStack gap="100">
              <Text as="p" fontWeight="semibold">
                💡 提示
              </Text>
              <List type="bullet">
                {testGuide.tips.map((tip, i) => (
                  <List.Item key={i}>
                    <Text as="span" variant="bodySm">
                      {tip}
                    </Text>
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
