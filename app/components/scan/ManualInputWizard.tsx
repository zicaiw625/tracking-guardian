import { useState, useCallback } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Checkbox,
  TextField,
  Banner,
  List,
  Divider,
  Box,
  Badge,
} from "@shopify/polaris";
import { CheckCircleIcon, ArrowRightIcon } from "~/components/icons";

export interface ManualInputWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: (data: ManualInputData) => void;
}

export interface ManualInputData {
  platforms: string[];
  features: string[];
  additionalInfo?: string;
  fromUpgradeWizard?: boolean;
}

const AVAILABLE_PLATFORMS = [
  { value: "google", label: "Google Analytics / GA4" },
  { value: "meta", label: "Meta Pixel / Facebook" },
  { value: "tiktok", label: "TikTok Pixel" },
  { value: "pinterest", label: "Pinterest Tag" },
  { value: "snapchat", label: "Snapchat Pixel" },
  { value: "clarity", label: "Microsoft Clarity" },
  { value: "hotjar", label: "Hotjar" },
  { value: "other", label: "其他平台" },
];

const AVAILABLE_FEATURES = [
  { value: "survey", label: "售后问卷 / 评价收集" },
  { value: "support", label: "客服入口 / 帮助中心" },
  { value: "reorder", label: "再购功能" },
  { value: "affiliate", label: "联盟追踪 / 分佣" },
  { value: "upsell", label: "追加销售 / 推荐商品" },
  { value: "tracking", label: "订单追踪 / 物流查询" },
  { value: "other", label: "其他功能" },
];

export function ManualInputWizard({ open, onClose, onComplete }: ManualInputWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [fromUpgradeWizard, setFromUpgradeWizard] = useState(false);

  const handlePlatformToggle = useCallback((platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }, []);

  const handleFeatureToggle = useCallback((feature: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  }, []);

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

  const handleComplete = useCallback(() => {
    onComplete({
      platforms: selectedPlatforms,
      features: selectedFeatures,
      additionalInfo: additionalInfo.trim() || undefined,
      fromUpgradeWizard,
    });

    setStep(1);
    setSelectedPlatforms([]);
    setSelectedFeatures([]);
    setAdditionalInfo("");
    setFromUpgradeWizard(false);
    onClose();
  }, [selectedPlatforms, selectedFeatures, additionalInfo, fromUpgradeWizard, onComplete, onClose]);

  const handleCancel = useCallback(() => {
    setStep(1);
    setSelectedPlatforms([]);
    setSelectedFeatures([]);
    setAdditionalInfo("");
    setFromUpgradeWizard(false);
    onClose();
  }, [onClose]);

  const canProceedFromStep1 = selectedPlatforms.length > 0 || selectedFeatures.length > 0;
  const canProceedFromStep2 = true;
  const canComplete = selectedPlatforms.length > 0 || selectedFeatures.length > 0;

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="补充迁移信息"
      primaryAction={
        step === 3
          ? {
              content: "完成",
              onAction: handleComplete,
              disabled: !canComplete,
            }
          : {
              content: "下一步",
              onAction: handleNext,
              disabled: step === 1 ? !canProceedFromStep1 : !canProceedFromStep2,
            }
      }
      secondaryActions={[
        ...(step > 1 ? [{ content: "上一步", onAction: handleBack }] : []),
        { content: "取消", onAction: handleCancel },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineStack gap="200" align="center">
            <Badge tone={step >= 1 ? "success" : "info"}>步骤 1</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 2 ? "success" : step > 2 ? "info" : undefined}>步骤 2</Badge>
            <Text as="span">→</Text>
            <Badge tone={step >= 3 ? "success" : undefined}>步骤 3</Badge>
          </InlineStack>

          {step === 1 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                您使用了哪些追踪平台？
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                勾选所有在 Thank you / Order status 页面使用的追踪平台
              </Text>

              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <strong>v1 支持范围</strong>：GA4、Meta、TikTok（其他平台将在 v1.1+ 支持）。请选择所有您使用的平台，系统将在报告中标注 v1 可迁移的项目。
                </Text>
              </Banner>

              <BlockStack gap="300">
                {AVAILABLE_PLATFORMS.map((platform) => {
                  const isV1Supported =
                    platform.value === "google" ||
                    platform.value === "meta" ||
                    platform.value === "tiktok";

                  return (
                    <InlineStack key={platform.value} gap="200" blockAlign="center">
                      <Checkbox
                        label={platform.label}
                        checked={selectedPlatforms.includes(platform.value)}
                        onChange={() => handlePlatformToggle(platform.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">v1 支持</Badge>
                      )}
                      {!isV1Supported && (platform.value === "pinterest" || platform.value === "snapchat") && (
                        <Badge tone="info" size="small">v1.1+</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>

              <Divider />

              <Text as="h3" variant="headingMd">
                您使用了哪些功能？
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                勾选所有在 Thank you / Order status 页面使用的功能
              </Text>

              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <strong>v1 支持范围</strong>：购后问卷（Survey）和帮助中心（Helpdesk）（其他功能将在 v1.1+ 支持）。请选择所有您使用的功能，系统将在报告中标注 v1 可迁移的项目。
                </Text>
              </Banner>

              <BlockStack gap="300">
                {AVAILABLE_FEATURES.map((feature) => {
                  const isV1Supported =
                    feature.value === "survey" ||
                    feature.value === "support";

                  return (
                    <InlineStack key={feature.value} gap="200" blockAlign="center">
                      <Checkbox
                        label={feature.label}
                        checked={selectedFeatures.includes(feature.value)}
                        onChange={() => handleFeatureToggle(feature.value)}
                      />
                      {isV1Supported && (
                        <Badge tone="success" size="small">v1 支持</Badge>
                      )}
                      {!isV1Supported && (
                        <Badge tone="info" size="small">v1.1+</Badge>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>

              {selectedPlatforms.length === 0 && selectedFeatures.length === 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    请至少选择一个平台或功能，以便我们生成准确的迁移建议
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}

          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                信息来源
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                这些信息来自哪里？
              </Text>

              <Checkbox
                label="来自 Shopify Admin 升级向导"
                checked={fromUpgradeWizard}
                onChange={(checked) => setFromUpgradeWizard(checked)}
                helpText="如果您从 Shopify 后台的升级向导中获取了脚本清单，请勾选此项"
              />

              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    如何从 Shopify 升级向导获取信息：
                  </Text>
                  <List type="number">
                    <List.Item>
                      前往 Shopify Admin → 设置 → 结账和订单处理
                    </List.Item>
                    <List.Item>
                      找到「Thank you / Order status 页面升级」部分
                    </List.Item>
                    <List.Item>
                      查看升级向导中列出的脚本和功能清单
                    </List.Item>
                    <List.Item>
                      将清单内容复制或截图，然后在此处补充
                    </List.Item>
                  </List>
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 <strong>提示：</strong>如果您从 Shopify 升级向导中看到了脚本清单，可以：
                  </Text>
                  <List>
                    <List.Item>
                      直接勾选上方对应的平台和功能（推荐）
                    </List.Item>
                    <List.Item>
                      或者将脚本内容复制到"手动粘贴脚本"区域进行分析
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
            </BlockStack>
          )}

          {step === 3 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                额外信息（可选）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                如果您有其他需要补充的信息，请在此处填写
              </Text>

              <TextField
                label="补充说明"
                value={additionalInfo}
                onChange={setAdditionalInfo}
                multiline={4}
                autoComplete="off"
                placeholder="例如：使用了自定义的订单追踪系统、集成了第三方客服工具等"
                helpText="这些信息将帮助我们更准确地评估迁移风险"
              />

              <Divider />

              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    信息摘要
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        选择的平台：
                      </Text>
                      {selectedPlatforms.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedPlatforms.map((p) => {
                            const platform = AVAILABLE_PLATFORMS.find((pl) => pl.value === p);
                            return (
                              <Badge key={p}>{platform?.label || p}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          无
                        </Text>
                      )}
                    </InlineStack>
                    <InlineStack gap="200" align="start">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        选择的功能：
                      </Text>
                      {selectedFeatures.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedFeatures.map((f) => {
                            const feature = AVAILABLE_FEATURES.find((fe) => fe.value === f);
                            return (
                              <Badge key={f}>{feature?.label || f}</Badge>
                            );
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          无
                        </Text>
                      )}
                    </InlineStack>
                    {fromUpgradeWizard && (
                      <InlineStack gap="200" align="center">
                        <CheckCircleIcon />
                        <Text as="span" variant="bodySm">
                          信息来自 Shopify 升级向导
                        </Text>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Box>
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

