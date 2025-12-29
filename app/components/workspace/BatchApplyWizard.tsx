

import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Box,
  Divider,
  Banner,
  List,
  Badge,
  ProgressBar,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { CheckCircleIcon, AlertCircleIcon } from "~/components/icons";

export interface PixelTemplate {
  id: string;
  name: string;
  description?: string;
  platforms: Array<{
    platform: string;
    eventMappings?: Record<string, string>;
    clientSideEnabled?: boolean;
    serverSideEnabled?: boolean;
  }>;
  usageCount?: number;
}

export interface ShopInfo {
  shopId: string;
  shopDomain: string;
  hasExistingConfig?: boolean;
}

interface BatchApplyWizardProps {
  template: PixelTemplate;
  targetShops: ShopInfo[];
  onConfirm: (options: {
    overwriteExisting: boolean;
    skipIfExists: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

type WizardStep = "preview" | "confirm" | "applying" | "complete";

export function BatchApplyWizard({
  template,
  targetShops,
  onConfirm,
  onCancel,
}: BatchApplyWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("preview");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [skipIfExists, setSkipIfExists] = useState(true);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{
    success: number;
    failed: number;
    skipped: number;
  } | null>(null);

  const handleApply = useCallback(async () => {
    setCurrentStep("applying");
    setProgress(0);

    try {

      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      await onConfirm({
        overwriteExisting,
        skipIfExists,
      });

      clearInterval(progressInterval);
      setProgress(100);
      setCurrentStep("complete");
    } catch (error) {
      setCurrentStep("confirm");
      throw error;
    }
  }, [onConfirm, overwriteExisting, skipIfExists]);

  if (currentStep === "preview") {

    const shopsWithConfig = targetShops.filter((s) => s.hasExistingConfig).length;
    const shopsWithoutConfig = targetShops.length - shopsWithConfig;
    const platformsInTemplate = template.platforms.map((p) => p.platform);

    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            预览批量应用
          </Text>

          <BlockStack gap="300">
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  模板信息
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" fontWeight="semibold">
                    {template.name}
                  </Text>
                  {template.usageCount !== undefined && (
                    <Badge tone="info">已使用 {template.usageCount} 次</Badge>
                  )}
                </InlineStack>
                {template.description && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {template.description}
                  </Text>
                )}
                <Divider />
                <Text as="h4" variant="headingSm">
                  包含平台 ({platformsInTemplate.length} 个)
                </Text>
                <List type="bullet">
                  {template.platforms.map((p, idx) => (
                    <List.Item key={idx}>
                      <Text as="span" variant="bodySm">
                        {p.platform.charAt(0).toUpperCase() + p.platform.slice(1)}
                        {p.clientSideEnabled && " (客户端)"}
                        {p.serverSideEnabled && " (服务端)"}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Box>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  目标店铺统计
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">总店铺数</Text>
                  <Badge>{targetShops.length}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">已有配置</Text>
                  <Badge tone="warning">{shopsWithConfig}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">无配置（将新建）</Text>
                  <Badge tone="success">{shopsWithoutConfig}</Badge>
                </InlineStack>
              </BlockStack>
            </Box>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  目标店铺列表 ({targetShops.length} 个)
                </Text>
                <List type="bullet">
                  {targetShops.slice(0, 5).map((shop) => (
                    <List.Item key={shop.shopId}>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm">
                          {shop.shopDomain}
                        </Text>
                        {shop.hasExistingConfig && (
                          <Badge tone="warning">已有配置</Badge>
                        )}
                        {!shop.hasExistingConfig && (
                          <Badge tone="success">将新建</Badge>
                        )}
                      </InlineStack>
                    </List.Item>
                  ))}
                  {targetShops.length > 5 && (
                    <List.Item>
                      <Text as="span" variant="bodySm" tone="subdued">
                        还有 {targetShops.length - 5} 个店铺...
                      </Text>
                    </List.Item>
                  )}
                </List>
              </BlockStack>
            </Box>

            {}
            {shopsWithConfig > 0 && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    差异对比提示
                  </Text>
                  <Text as="p" variant="bodySm">
                    检测到 {shopsWithConfig} 个店铺已有像素配置。应用模板时：
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        如果选择"覆盖"，将替换现有配置为模板配置
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        如果选择"跳过"，将保留现有配置，只应用到新店铺
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        建议：在下一步查看详细差异对比
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            )}

            <Banner tone="info">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  <strong>重要提示：</strong>
                </Text>
                <List type="bullet">
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      模板只包含配置结构，不包含 API 凭证
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      各店铺需要在应用后单独配置 API Key 和 Access Token
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" variant="bodySm">
                      如果店铺已有配置，可以选择覆盖或跳过
                    </Text>
                  </List.Item>
                </List>
              </BlockStack>
            </Banner>
          </BlockStack>

          <InlineStack align="end" gap="200">
            <Button onClick={onCancel}>取消</Button>
            <Button variant="primary" onClick={() => setCurrentStep("confirm")}>
              下一步
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "confirm") {
    const shopsWithConfig = targetShops.filter((s) => s.hasExistingConfig).length;

    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            确认批量应用
          </Text>

          <BlockStack gap="300">
            {shopsWithConfig > 0 && (
              <Banner tone="warning">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    检测到 {shopsWithConfig} 个店铺已有像素配置
                  </Text>
                  <Checkbox
                    label="覆盖已存在的配置"
                    checked={overwriteExisting}
                    onChange={setOverwriteExisting}
                    helpText="如果启用，将替换现有配置；如果禁用，将跳过已有配置的店铺"
                  />
                  <Checkbox
                    label="跳过已有配置的店铺"
                    checked={skipIfExists}
                    onChange={setSkipIfExists}
                    disabled={overwriteExisting}
                    helpText="如果启用，将跳过已有配置的店铺，只应用到新店铺"
                  />
                </BlockStack>
              </Banner>
            )}

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  应用摘要
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">模板</Text>
                  <Text as="span" fontWeight="semibold">{template.name}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">目标店铺</Text>
                  <Text as="span" fontWeight="semibold">{targetShops.length} 个</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">包含平台</Text>
                  <Text as="span" fontWeight="semibold">
                    {template.platforms.length} 个
                  </Text>
                </InlineStack>
                {shopsWithConfig > 0 && (
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">处理方式</Text>
                    <Text as="span" fontWeight="semibold">
                      {overwriteExisting ? "覆盖已有配置" : skipIfExists ? "跳过已有配置" : "保留已有配置"}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </Box>
          </BlockStack>

          <InlineStack align="end" gap="200">
            <Button onClick={() => setCurrentStep("preview")}>上一步</Button>
            <Button variant="primary" onClick={handleApply}>
              确认应用
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "applying") {
    return (
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            正在批量应用...
          </Text>

          <ProgressBar progress={progress} />

          <Text as="p" variant="bodySm" tone="subdued">
            正在将模板应用到 {targetShops.length} 个店铺，请稍候...
          </Text>
        </BlockStack>
      </Card>
    );
  }

  if (currentStep === "complete") {
    return (
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              批量应用完成
            </Text>
            <Badge tone="success">完成</Badge>
          </InlineStack>

          {results && (
            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  应用结果
                </Text>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">成功</Text>
                  <Badge tone="success">{results.success}</Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">失败</Text>
                  <Badge tone={results.failed > 0 ? "critical" : "success"}>
                    {results.failed}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">跳过</Text>
                  <Badge tone="info">{results.skipped}</Badge>
                </InlineStack>
              </BlockStack>
            </Box>
          )}

          <Banner tone="success">
            <Text as="p" variant="bodySm">
              批量应用已完成。请在各店铺中单独配置 API 凭证以启用追踪功能。
            </Text>
          </Banner>

          <InlineStack align="end">
            <Button variant="primary" onClick={onCancel}>
              完成
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    );
  }

  return null;
}

