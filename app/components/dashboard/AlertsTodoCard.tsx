import { Card, BlockStack, InlineStack, Text, Badge, Button, List, Icon } from "@shopify/polaris";
import { AlertCircleIcon, CheckCircleIcon } from "~/components/icons";

interface AlertsTodoCardProps {
  alerts: Array<{
    id: string;
    type: string;
    severity: "critical" | "warning" | "info";
    message: string;
    triggeredAt: Date;
  }>;
}

export function AlertsTodoCard({ alerts }: AlertsTodoCardProps) {
  if (alerts.length === 0) {
    return (
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              告警与待办
            </Text>
            <Badge tone="success">
              <InlineStack gap="100" blockAlign="center">
                <Icon source={CheckCircleIcon} />
                <Text as="span">正常</Text>
              </InlineStack>
            </Badge>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            当前没有活跃告警
          </Text>
        </BlockStack>
      </Card>
    );
  }

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            告警与待办
          </Text>
          <Badge tone={criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "info"}>
            {alerts.length} 个活跃告警
          </Badge>
        </InlineStack>

        <List>
          {alerts.slice(0, 3).map((alert) => (
            <List.Item key={alert.id}>
              <InlineStack align="space-between" blockAlign="start" gap="300">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={AlertCircleIcon} />
                    <Badge
                      tone={
                        alert.severity === "critical"
                          ? "critical"
                          : alert.severity === "warning"
                          ? "warning"
                          : "info"
                      }
                    >
                      {alert.severity === "critical"
                        ? "严重"
                        : alert.severity === "warning"
                        ? "警告"
                        : "信息"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm">
                    {alert.message}
                  </Text>
                </BlockStack>
              </InlineStack>
            </List.Item>
          ))}
        </List>

        {alerts.length > 3 && (
          <Text as="p" variant="bodySm" tone="subdued">
            还有 {alerts.length - 3} 个告警未显示
          </Text>
        )}

        <Button url="/app/monitor" variant="primary" fullWidth>
          查看全部告警
        </Button>
      </BlockStack>
    </Card>
  );
}
