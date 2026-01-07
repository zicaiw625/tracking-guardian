import { Card, BlockStack, InlineStack, Text, Button, Badge, List } from "@shopify/polaris";

interface PageIntroCardProps {
  title: string;
  description: string;
  badge?: { tone?: "info" | "success" | "warning" | "critical" | "attention"; content: string };
  items?: string[];
  primaryAction?: { content: string; url: string };
  secondaryAction?: { content: string; url: string };
}

export function PageIntroCard({
  title,
  description,
  badge,
  items,
  primaryAction,
  secondaryAction,
}: PageIntroCardProps) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            {badge && <Badge tone={badge.tone}>{badge.content}</Badge>}
          </InlineStack>
          {(primaryAction || secondaryAction) && (
            <InlineStack gap="200">
              {secondaryAction && (
                <Button url={secondaryAction.url} size="slim" variant="plain">
                  {secondaryAction.content}
                </Button>
              )}
              {primaryAction && (
                <Button url={primaryAction.url} size="slim" variant="primary">
                  {primaryAction.content}
                </Button>
              )}
            </InlineStack>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
        {items && items.length > 0 && (
          <List type="bullet">
            {items.map((item) => (
              <List.Item key={item}>{item}</List.Item>
            ))}
          </List>
        )}
      </BlockStack>
    </Card>
  );
}
