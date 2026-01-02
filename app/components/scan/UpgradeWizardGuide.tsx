import { useState, useCallback } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  List,
  Divider,
  Box,
  Card,
  Link,
  Icon,
  TextField,
} from "@shopify/polaris";
import { ExternalIcon, ImageIcon, ClipboardIcon } from "~/components/icons";

export interface UpgradeWizardGuideProps {
  open: boolean;
  onClose: () => void;
  onImportFromWizard?: () => void;
  onPasteContent?: (content: string) => void;
  onUploadScreenshot?: (file: File) => void;
}

export function UpgradeWizardGuide({
  open,
  onClose,
  onImportFromWizard,
  onPasteContent,
  onUploadScreenshot,
}: UpgradeWizardGuideProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pastedContent, setPastedContent] = useState("");

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file && file.type.startsWith("image/")) {
        onUploadScreenshot?.(file);
        onClose();
      }
    },
    [onUploadScreenshot, onClose]
  );

  const handlePasteSubmit = useCallback(() => {
    if (pastedContent.trim()) {
      onPasteContent?.(pastedContent.trim());
      setPastedContent("");
      onClose();
    }
  }, [pastedContent, onPasteContent, onClose]);

  const handleNext = useCallback(() => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    }
  }, [step]);

  const handleCancel = useCallback(() => {
    setStep(1);
    setPastedContent("");
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="从 Shopify 升级向导导入"
      primaryAction={
        step === 3
          ? {
              content: "提交",
              onAction: handlePasteSubmit,
              disabled: !pastedContent.trim(),
            }
          : {
              content: "下一步",
              onAction: handleNext,
            }
      }
      secondaryActions={[
        ...(step > 1 ? [{ content: "上一步", onAction: handleBack }] : []),
        { content: "取消", onAction: handleCancel },
      ]}
      large
    >
      <Modal.Section>
        <BlockStack gap="400">
          {}
          <InlineStack gap="200" align="center">
            <Text
              as="span"
              variant="bodySm"
              tone={step >= 1 ? "success" : "subdued"}
              fontWeight={step >= 1 ? "semibold" : "regular"}
            >
              步骤 1
            </Text>
            <Text as="span" tone="subdued">→</Text>
            <Text
              as="span"
              variant="bodySm"
              tone={step >= 2 ? "success" : "subdued"}
              fontWeight={step >= 2 ? "semibold" : "regular"}
            >
              步骤 2
            </Text>
            <Text as="span" tone="subdued">→</Text>
            <Text
              as="span"
              variant="bodySm"
              tone={step >= 3 ? "success" : "subdued"}
              fontWeight={step >= 3 ? "semibold" : "regular"}
            >
              步骤 3
            </Text>
          </InlineStack>

          {}
          {step === 1 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                如何访问 Shopify 升级向导
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                按照以下步骤在 Shopify Admin 中找到升级向导和脚本清单
              </Text>

              <Card>
                <BlockStack gap="300">
                  <List type="number">
                    <List.Item>
                      <Text as="p" variant="bodySm">
                        登录 Shopify Admin，前往{" "}
                        <strong>设置 → 结账和订单处理</strong>
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="p" variant="bodySm">
                        找到{" "}
                        <strong>
                          「Thank you / Order status 页面升级」
                        </strong>{" "}
                        部分
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="p" variant="bodySm">
                        点击{" "}
                        <strong>「查看需要迁移的脚本」</strong>或类似按钮
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="p" variant="bodySm">
                        升级向导会显示当前 Thank you / Order status
                        页面使用的脚本和功能清单
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>

              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    💡 提示
                  </Text>
                  <Text as="p" variant="bodySm">
                    如果您的店铺已经升级到新的 Thank you / Order status
                    页面，可能看不到升级向导。您可以：
                  </Text>
                  <List>
                    <List.Item>
                      使用"手动粘贴脚本"功能，从 Additional Scripts
                      中复制代码进行分析
                    </List.Item>
                    <List.Item>
                      或者直接勾选您使用的平台和功能
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>

              <Box paddingBlockStart="400">
                <Link
                  url="https:
                  external
                >
                  <InlineStack gap="200" align="center">
                    <Text as="span" variant="bodySm">
                      查看 Shopify 官方文档
                    </Text>
                    <Icon source={ExternalIcon} />
                  </InlineStack>
                </Link>
              </Box>
            </BlockStack>
          )}

          {}
          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                选择导入方式
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                您可以通过以下方式将升级向导中的信息导入到 Tracking Guardian
              </Text>

              <BlockStack gap="300">
                {}
                {onImportFromWizard && (
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" align="start">
                        <Icon source={ClipboardIcon} />
                        <BlockStack gap="200">
                          <Text as="h4" variant="headingSm">
                            方式 1: 自动导入（推荐）
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            如果 Shopify 提供了 API 访问，我们可以自动读取升级向导中的清单
                          </Text>
                          <Button
                            variant="primary"
                            onClick={() => {
                              onImportFromWizard();
                              onClose();
                            }}
                          >
                            尝试自动导入
                          </Button>
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                )}

                {}
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" align="start">
                      <Icon source={ClipboardIcon} />
                      <BlockStack gap="200">
                        <Text as="h4" variant="headingSm">
                          方式 2: 复制粘贴清单内容
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          从升级向导中复制脚本清单或代码片段，粘贴到下方文本框
                        </Text>
                        <Button
                          variant="secondary"
                          onClick={() => setStep(3)}
                        >
                          粘贴内容
                        </Button>
                      </BlockStack>
                    </InlineStack>
                  </BlockStack>
                </Card>

                {}
                {onUploadScreenshot && (
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" align="start">
                        <Icon source={ImageIcon} />
                        <BlockStack gap="200">
                          <Text as="h4" variant="headingSm">
                            方式 3: 上传截图
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            对升级向导中的清单进行截图，我们将尝试识别其中的平台和功能
                          </Text>
                          <Box>
                            <input
                              type="file"
                              accept="image

