import { useState, useCallback } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  TextField,
  Banner,
  List,
  Divider,
  Box,
  Badge,
  Card,
} from "@shopify/polaris";
import { CheckCircleIcon } from "~/components/icons";
import { useFetcher } from "@remix-run/react";

export interface GuidedSupplementProps {
  open: boolean;
  onClose: () => void;
  onComplete?: (count: number) => void;
  shopId: string;
}

const UPGRADE_WIZARD_CHECKLIST = [
  { id: "ga4", label: "Google Analytics 4 (GA4)", category: "pixel", platform: "google" },
  { id: "meta", label: "Meta Pixel (Facebook)", category: "pixel", platform: "meta" },
  { id: "tiktok", label: "TikTok Pixel", category: "pixel", platform: "tiktok" },
  { id: "survey", label: "售后问卷 / 评价收集", category: "survey", platform: undefined },
  { id: "support", label: "客服入口 / 帮助中心", category: "support", platform: undefined },
  { id: "reorder", label: "再购功能", category: "other", platform: undefined },
  { id: "affiliate", label: "联盟追踪 / 分佣", category: "affiliate", platform: undefined },
  { id: "tracking", label: "订单追踪 / 物流查询", category: "support", platform: undefined },
  { id: "other", label: "其他脚本或功能", category: "other", platform: undefined },
];

export function GuidedSupplement({ open, onClose, onComplete, shopId: _shopId }: GuidedSupplementProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const fetcher = useFetcher();
  const handleItemToggle = useCallback((itemId: string) => {
    setSelectedItems((prev) => (prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]));
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
  const extractFeaturesFromText = useCallback((text: string): string[] => {
    const lowerText = text.toLowerCase();
    const detectedItems: string[] = [];
    const keywordMap: Record<string, string[]> = {
      ga4: ["ga4", "google analytics 4", "g-"],
      google: ["google analytics", "gtag", "google tag"],
      meta: ["meta pixel", "facebook pixel", "fbq", "fb pixel"],
      tiktok: ["tiktok pixel", "ttq", "tiktok"],
      pinterest: ["pinterest tag", "pintrk", "pinterest"],
      snapchat: ["snapchat pixel", "snaptr", "snapchat"],
      survey: ["survey", "问卷", "评价", "feedback", "fairing", "zigpoll"],
      support: ["support", "客服", "helpdesk", "zendesk", "intercom"],
      reorder: ["reorder", "再购", "再次购买"],
      affiliate: ["affiliate", "联盟", "referral", "commission"],
      upsell: ["upsell", "追加销售", "推荐商品"],
      tracking: ["tracking", "追踪", "物流", "aftership", "17track"],
    };
    Object.entries(keywordMap).forEach(([key, keywords]) => {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const itemId =
          key === "ga4"
            ? "ga4"
            : key === "google"
              ? "ga4"
              : key === "meta"
                ? "meta"
                : key === "tiktok"
                  ? "tiktok"
                  : key === "pinterest"
                    ? "pinterest"
                    : key === "snapchat"
                      ? "snapchat"
                      : key === "survey"
                        ? "survey"
                        : key === "support"
                          ? "support"
                          : key === "reorder"
                            ? "reorder"
                            : key === "affiliate"
                              ? "affiliate"
                              : key === "upsell"
                                ? "upsell"
                                : key === "tracking"
                                  ? "tracking"
                                  : null;
        if (itemId && !detectedItems.includes(itemId)) {
          detectedItems.push(itemId);
        }
      }
    });
    return detectedItems;
  }, []);
  const handleComplete = useCallback(() => {
    if (selectedItems.length === 0) {
      return;
    }
    const finalSelectedItems = [...selectedItems];
    if (additionalNotes.trim()) {
      const detectedItems = extractFeaturesFromText(additionalNotes);
      detectedItems.forEach((itemId) => {
        if (!finalSelectedItems.includes(itemId)) {
          finalSelectedItems.push(itemId);
        }
      });
    }
    const assets = finalSelectedItems
      .map((itemId) => {
        const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
        if (!item) return null;
        return {
          sourceType: "merchant_confirmed" as const,
          category: item.category as "pixel" | "affiliate" | "survey" | "support" | "analytics" | "other",
          platform: item.platform,
          displayName: item.label,
          riskLevel: item.category === "pixel" ? ("high" as const) : ("medium" as const),
          suggestedMigration:
            item.category === "pixel"
              ? ("web_pixel" as const)
              : item.category === "survey" || item.category === "support"
                ? ("ui_extension" as const)
                : item.category === "affiliate"
                  ? ("server_side" as const)
                  : ("none" as const),
          details: {
            fromUpgradeWizard: true,
            additionalNotes: additionalNotes.trim() || undefined,
            autoDetected: !selectedItems.includes(itemId),
          },
        };
      })
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null);
    fetcher.submit(
      {
        _action: "create_from_wizard",
        assets: JSON.stringify(assets),
      },
      { method: "post" }
    );
  }, [selectedItems, additionalNotes, fetcher, extractFeaturesFromText]);
  if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
    const result = fetcher.data as { created?: number; updated?: number };
    const totalCreated = (result.created || 0) + (result.updated || 0);
    if (onComplete && totalCreated > 0) {
      setTimeout(() => {
        onComplete(totalCreated);
        setStep(1);
        setSelectedItems([]);
        setAdditionalNotes("");
        onClose();
      }, 1000);
    }
  }
  const handleCancel = useCallback(() => {
    setStep(1);
    setSelectedItems([]);
    setAdditionalNotes("");
    onClose();
  }, [onClose]);
  const canProceedFromStep1 = selectedItems.length > 0;
  const canProceedFromStep2 = true;
  const canComplete = selectedItems.length > 0;
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="从 Shopify 升级向导补充信息"
      primaryAction={
        step === 3
          ? {
              content: "完成",
              onAction: handleComplete,
              disabled: !canComplete || fetcher.state === "submitting",
              loading: fetcher.state === "submitting",
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
                从升级向导中选择使用的功能
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                请根据 Shopify 升级向导中显示的清单，勾选所有在 Thank you / Order status 页面使用的功能
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    如何获取升级向导清单：
                  </Text>
                  <List type="number">
                    <List.Item>前往 Shopify Admin → 设置 → 结账和订单处理</List.Item>
                    <List.Item>找到「Thank you / Order status 页面升级」部分</List.Item>
                    <List.Item>查看升级向导中列出的脚本和功能清单</List.Item>
                    <List.Item>勾选下方对应的功能</List.Item>
                  </List>
                </BlockStack>
              </Banner>
              <Banner tone="warning">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    v1 支持范围说明：
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>像素平台</strong>：v1 仅支持 GA4、Meta、TikTok（其他平台将在 v1.1+ 支持）
                  </Text>
                  <Text as="p" variant="bodySm">
                    • <strong>UI 模块</strong>：v1 不提供 Survey/Helpdesk 等页面模块
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    请选择所有您使用的功能，系统将在报告中标注 v1 可迁移的项目。
                  </Text>
                </BlockStack>
              </Banner>
              <BlockStack gap="300">
                {UPGRADE_WIZARD_CHECKLIST.map((item) => {
                  const isV1Supported = item.id === "ga4" || item.id === "meta" || item.id === "tiktok";
                  return (
                    <Box
                      key={item.id}
                      background={selectedItems.includes(item.id) ? "bg-surface-success" : "bg-surface-secondary"}
                      padding="300"
                      borderRadius="200"
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <Checkbox
                          label={item.label}
                          checked={selectedItems.includes(item.id)}
                          onChange={() => handleItemToggle(item.id)}
                        />
                        {isV1Supported && (
                          <Badge tone="success" size="small">
                            v1 支持
                          </Badge>
                        )}
                        {!isV1Supported &&
                          (item.category === "pixel" || item.category === "survey" || item.category === "support") && (
                            <Badge tone="info" size="small">
                              v1.1+
                            </Badge>
                          )}
                      </InlineStack>
                    </Box>
                  );
                })}
              </BlockStack>
              {selectedItems.length === 0 && (
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    请至少选择一个功能，以便我们生成准确的迁移建议
                  </Text>
                </Banner>
              )}
            </BlockStack>
          )}
          {step === 2 && (
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">
                补充信息（可选）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                如果您从升级向导中复制了清单文本，可以在此处补充
              </Text>
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    两种方式补充信息：
                  </Text>
                  <List>
                    <List.Item>
                      <Text as="span" variant="bodySm">
                        <strong>方式一：</strong>从升级向导中复制清单文本，粘贴到下方文本框
                      </Text>
                    </List.Item>
                    <List.Item>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          <strong>方式二：</strong>上传升级向导的截图
                        </Text>
                        <Badge tone="info" size="small">
                          即将上线
                        </Badge>
                      </InlineStack>
                    </List.Item>
                  </List>
                </BlockStack>
              </Banner>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    粘贴升级向导清单文本：
                  </Text>
                  <TextField
                    label="清单内容"
                    value={additionalNotes}
                    onChange={setAdditionalNotes}
                    multiline={6}
                    placeholder="从 Shopify 升级向导中复制的清单文本..."
                    helpText="粘贴后，系统会自动识别并匹配已选择的功能"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
              <Banner>
                <Text as="p" variant="bodySm">
                  💡 <strong>提示：</strong>
                  截图识别暂未开放，请使用“文本粘贴”方式补充。若识别失败或内容缺失，请回退到方式一。
                </Text>
              </Banner>
              <Card>
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" fontWeight="semibold">
                    已选择的功能：
                  </Text>
                  <InlineStack gap="100" wrap>
                    {selectedItems.map((itemId) => {
                      const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                      return item ? <Badge key={itemId}>{item.label}</Badge> : null;
                    })}
                  </InlineStack>
                </BlockStack>
              </Card>
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
                value={additionalNotes}
                onChange={setAdditionalNotes}
                multiline={4}
                placeholder="例如：使用了自定义的订单追踪系统、集成了第三方客服工具等"
                helpText="这些信息将帮助我们更准确地评估迁移风险"
                autoComplete="off"
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
                        手动选择的功能：
                      </Text>
                      {selectedItems.length > 0 ? (
                        <InlineStack gap="100" wrap>
                          {selectedItems.map((itemId) => {
                            const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                            return item ? (
                              <Badge key={itemId} tone="info">
                                {item.label}
                              </Badge>
                            ) : null;
                          })}
                        </InlineStack>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">
                          无
                        </Text>
                      )}
                    </InlineStack>
                    {additionalNotes.trim() &&
                      (() => {
                        const detectedItems = extractFeaturesFromText(additionalNotes);
                        const autoDetected = detectedItems.filter((id) => !selectedItems.includes(id));
                        return autoDetected.length > 0 ? (
                          <InlineStack gap="200" align="start">
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              自动检测到的功能：
                            </Text>
                            <InlineStack gap="100" wrap>
                              {autoDetected.map((itemId) => {
                                const item = UPGRADE_WIZARD_CHECKLIST.find((i) => i.id === itemId);
                                return item ? (
                                  <Badge key={itemId} tone="success">
                                    {item.label}
                                  </Badge>
                                ) : null;
                              })}
                            </InlineStack>
                          </InlineStack>
                        ) : null;
                      })()}
                    <InlineStack gap="200" align="center">
                      <CheckCircleIcon />
                      <Text as="span" variant="bodySm">
                        信息来自 Shopify 升级向导
                        {additionalNotes.trim() && " + 文本智能识别"}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Box>
              {fetcher.data && (fetcher.data as { error?: string }).error ? (
                <Banner tone="critical">
                  <Text as="p" variant="bodySm">
                    {(fetcher.data as { error: string }).error}
                  </Text>
                </Banner>
              ) : null}
              {fetcher.data && (fetcher.data as { success?: boolean }).success ? (
                <Banner tone="success">
                  <Text as="p" variant="bodySm">
                    成功创建迁移资产！
                  </Text>
                </Banner>
              ) : null}
            </BlockStack>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
