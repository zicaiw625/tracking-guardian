import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, BlockStack, Box, Button, Card, Icon, InlineStack, ProgressBar, Text } from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { getSetupProgress, type SetupStep } from "~/types/dashboard";

export const SetupProgressCard = memo(function SetupProgressCard({
  steps,
  nextStep,
}: {
  steps: SetupStep[];
  nextStep: SetupStep | undefined;
}) {
  const { t } = useTranslation();
  const progress = useMemo(() => getSetupProgress(steps), [steps]);
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">
            {t("dashboard.setup.title")}
          </Text>
          <Badge tone="attention">
            {t("dashboard.setup.completed", { completed: progress.completed, total: progress.total })}
          </Badge>
        </InlineStack>
        <ProgressBar progress={progress.percentage} tone="primary" size="small" />
        <BlockStack gap="300">
          {steps.map((step, index) => (
            <Box
              key={step.id}
              background={step.done ? "bg-surface-success" : "bg-surface-secondary"}
              padding="400"
              borderRadius="200"
            >
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Box>
                    {step.done ? (
                      <Icon source={CheckCircleIcon} tone="success" />
                    ) : (
                      <Text as="span" variant="bodyMd" fontWeight="bold">
                        {index + 1}
                      </Text>
                    )}
                  </Box>
                  <BlockStack gap="100">
                    <Text
                      as="span"
                      fontWeight="semibold"
                      tone={step.done ? "success" : undefined}
                    >
                      {step.label}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {step.description}
                    </Text>
                  </BlockStack>
                </InlineStack>
                {!step.done && (
                  <Button
                    url={step.url}
                    size="slim"
                    variant={step.id === nextStep?.id ? "primary" : undefined}
                  >
                    {step.cta}
                  </Button>
                )}
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
});
