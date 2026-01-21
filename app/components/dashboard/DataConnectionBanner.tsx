import { Banner, Button, BlockStack, InlineStack, Text } from "@shopify/polaris";

interface DataConnectionBannerProps {
  hasIngestionSecret: boolean;
  hasWebPixel: boolean;
  webPixelHasIngestionKey: boolean;
  shopDomain: string;
}

export function DataConnectionBanner({
  hasIngestionSecret,
  hasWebPixel,
  webPixelHasIngestionKey,
  shopDomain: _shopDomain,
}: DataConnectionBannerProps) {
  const issues: string[] = [];
  if (!hasIngestionSecret) {
    issues.push("Ingestion Key未配置");
  }
  if (!hasWebPixel) {
    issues.push("Web Pixel未安装");
  } else if (!webPixelHasIngestionKey) {
    issues.push("Web Pixel配置缺失ingestion_key");
  }

  if (issues.length === 0) {
    return null;
  }

  const getMessage = () => {
    if (!hasIngestionSecret && !hasWebPixel) {
      return "数据连接未配置：需要配置Ingestion Key并安装Web Pixel才能开始接收追踪数据";
    }
    if (!hasIngestionSecret) {
      return "数据连接未完成：需要配置Ingestion Key";
    }
    if (!hasWebPixel) {
      return "数据连接未完成：需要安装Web Pixel";
    }
    return "数据连接配置不完整：Web Pixel配置缺失ingestion_key，请重新同步配置";
  };

  const getActionUrl = () => {
    if (!hasIngestionSecret) {
      return "/app/settings";
    }
    if (!hasWebPixel || !webPixelHasIngestionKey) {
      return "/app/pixels";
    }
    return "/app/settings";
  };

  const getActionLabel = () => {
    if (!hasIngestionSecret) {
      return "前往设置";
    }
    if (!hasWebPixel) {
      return "安装Web Pixel";
    }
    return "修复配置";
  };

  return (
    <Banner tone="critical" title="数据未接入">
      <BlockStack gap="200">
        <Text as="p">{getMessage()}</Text>
        <Text as="p" variant="bodySm" tone="subdued">
          问题：{issues.join("、")}
        </Text>
        <InlineStack gap="200">
          <Button variant="primary" url={getActionUrl()}>
            {getActionLabel()}
          </Button>
          <Button url="/app/diagnostics">查看诊断详情</Button>
        </InlineStack>
      </BlockStack>
    </Banner>
  );
}
