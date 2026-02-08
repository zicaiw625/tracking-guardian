import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  TextField,
  Checkbox,
  List,
  Modal,
  Icon,
  Collapsible,
  ProgressBar,
} from "@shopify/polaris";
import { CheckCircleIcon, ClipboardIcon, InfoIcon, ExternalIcon } from "../icons";

export interface MigrationItem {
  id: string;
  name: string;
  type: "script_tag" | "additional_script" | "checkout_liquid" | "app_pixel" | "other";
  platform?: string;
  source: "api_scan" | "manual_paste" | "merchant_confirmed";
  riskLevel: "high" | "medium" | "low";
  suggestedMigration: "web_pixel" | "ui_extension" | "server_side" | "none";
  confirmed: boolean;
  notes?: string;
  estimatedTimeMinutes?: number;
  migrationStatus?: "pending" | "in_progress" | "completed" | "skipped";
}

export interface MigrationChecklistProps {
  items: MigrationItem[];
  onItemConfirm: (itemId: string, confirmed: boolean) => void;
  onAddManualItem: (item: Omit<MigrationItem, "id" | "confirmed">) => void;
  onExportChecklist: () => void;
  shopTier: "plus" | "non_plus" | "unknown";
}

const getMigrationTypeLabel = (type: MigrationItem["suggestedMigration"]) => {
  switch (type) {
    case "web_pixel":
      return "Web Pixel";
    case "ui_extension":
      return "手动迁移";
    case "server_side":
      return "不提供";
    case "none":
      return "External redirect / not supported";
    default:
      return "待评估";
  }
};

const getRiskBadge = (level: MigrationItem["riskLevel"]) => {
  switch (level) {
    case "high":
      return <Badge tone="critical">高风险</Badge>;
    case "medium":
      return <Badge tone="warning">中风险</Badge>;
    case "low":
      return <Badge tone="success">低风险</Badge>;
  }
};

const getTypeLabel = (type: MigrationItem["type"]) => {
  switch (type) {
    case "script_tag":
      return "ScriptTag";
    case "additional_script":
      return "Additional Script";
    case "checkout_liquid":
      return "checkout.liquid";
    case "app_pixel":
      return "App Pixel";
    case "other":
      return "其他";
  }
};

export function MigrationChecklist({
  items,
  onItemConfirm,
  onAddManualItem,
  onExportChecklist,
  shopTier,
}: MigrationChecklistProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<MigrationItem["type"]>("additional_script");
  const [newItemNotes, setNewItemNotes] = useState("");
  const confirmedCount = items.filter((i) => i.confirmed).length;
  const highRiskCount = items.filter((i) => i.riskLevel === "high").length;
  const pendingCount = items.filter((i) => !i.confirmed).length;
  const totalEstimatedMinutes = items
    .filter((i) => i.confirmed && i.estimatedTimeMinutes)
    .reduce((sum, i) => sum + (i.estimatedTimeMinutes || 0), 0);
  const totalEstimatedHours = Math.ceil(totalEstimatedMinutes / 60);
  const progressPercent = items.length > 0 ? Math.round((confirmedCount / items.length) * 100) : 100;
  const handleAddItem = useCallback(() => {
    if (!newItemName.trim()) return;
    onAddManualItem({
      name: newItemName.trim(),
      type: newItemType,
      source: "merchant_confirmed",
      riskLevel: "medium",
      suggestedMigration: newItemType === "additional_script" ? "web_pixel" : "none",
      notes: newItemNotes.trim() || undefined,
    });
    setNewItemName("");
    setNewItemNotes("");
    setShowAddModal(false);
  }, [newItemName, newItemType, newItemNotes, onAddManualItem]);
  const shopifyUpgradeUrl = shopTier === "plus" ? "https://www.shopify.com/pricing" : "https://www.shopify.com/pricing";
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  📋 迁移清单确认
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  确认需要迁移的资产，补充自动扫描未识别的项目
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Badge tone={confirmedCount === items.length ? "success" : "attention"}>
                  {`${confirmedCount}/${items.length} 已确认`}
                </Badge>
                {highRiskCount > 0 && <Badge tone="critical">{`${highRiskCount} 高风险`}</Badge>}
              </InlineStack>
            </InlineStack>
            {items.length > 0 && (
              <BlockStack gap="200">
                <ProgressBar progress={progressPercent} tone="primary" size="small" />
                <InlineStack gap="400" align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    进度: {progressPercent}%
                  </Text>
                  {totalEstimatedMinutes > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      预计总时间:{" "}
                      {totalEstimatedHours > 0
                        ? `${totalEstimatedHours} 小时 ${totalEstimatedMinutes % 60} 分钟`
                        : `${totalEstimatedMinutes} 分钟`}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
          <Divider />
          <Banner
            title="从 Shopify 升级向导补充信息"
            tone="info"
            action={{
              content: "查看指南",
              onAction: () => setShowGuideModal(true),
            }}
          >
            <Text as="p" variant="bodySm">
              Shopify 后台的升级向导可能包含我们无法自动检测的脚本。 点击「查看指南」了解如何从 Shopify
              获取完整的迁移清单。
            </Text>
          </Banner>
          <BlockStack gap="300">
            {items.length === 0 ? (
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200" align="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="p">未检测到需要迁移的资产</Text>
                  <Button onClick={() => setShowAddModal(true)} size="slim">
                    手动添加
                  </Button>
                </BlockStack>
              </Box>
            ) : (
              items.map((item) => (
                <Box
                  key={item.id}
                  background={item.confirmed ? "bg-surface-success" : "bg-surface-secondary"}
                  padding="400"
                  borderRadius="200"
                >
                  <InlineStack align="space-between" blockAlign="start">
                    <InlineStack gap="300" blockAlign="start">
                      <Checkbox
                        label=""
                        checked={item.confirmed}
                        onChange={(checked) => onItemConfirm(item.id, checked)}
                      />
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" fontWeight="semibold">
                            {item.name}
                          </Text>
                          {item.platform && <Badge>{item.platform}</Badge>}
                        </InlineStack>
                        <InlineStack gap="100" wrap>
                          <Badge tone="info">{getTypeLabel(item.type)}</Badge>
                          {getRiskBadge(item.riskLevel)}
                          <Text as="span" variant="bodySm" tone="subdued">
                            • {getMigrationTypeLabel(item.suggestedMigration)}
                          </Text>
                          {item.estimatedTimeMinutes && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              • 预计 {item.estimatedTimeMinutes} 分钟
                            </Text>
                          )}
                          {item.migrationStatus && (
                            <Badge
                              tone={
                                item.migrationStatus === "completed"
                                  ? "success"
                                  : item.migrationStatus === "in_progress"
                                    ? "info"
                                    : undefined
                              }
                            >
                              {item.migrationStatus === "completed"
                                ? "已完成"
                                : item.migrationStatus === "in_progress"
                                  ? "进行中"
                                  : "待处理"}
                            </Badge>
                          )}
                        </InlineStack>
                        {item.notes && (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {item.notes}
                          </Text>
                        )}
                      </BlockStack>
                    </InlineStack>
                    <Badge
                      tone={
                        item.source === "api_scan" ? "info" : item.source === "manual_paste" ? "attention" : "success"
                      }
                    >
                      {item.source === "api_scan"
                        ? "自动检测"
                        : item.source === "manual_paste"
                          ? "手动粘贴"
                          : "商家确认"}
                    </Badge>
                  </InlineStack>
                </Box>
              ))
            )}
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setManualExpanded(!manualExpanded)}
              onKeyDown={(e) => e.key === "Enter" && setManualExpanded(!manualExpanded)}
              style={{ cursor: "pointer", padding: "8px" }}
            >
              <InlineStack gap="200" blockAlign="center">
                <Icon source={InfoIcon} />
                <Text as="span">手动补充未识别的脚本</Text>
                <Text as="span" tone="subdued">
                  {manualExpanded ? "▲ 收起" : "▼ 展开"}
                </Text>
              </InlineStack>
            </div>
            <Collapsible open={manualExpanded} id="manual-section">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm">
                    如果您在 Shopify 升级向导或 checkout.liquid 中发现了我们未检测到的脚本，
                    可以在这里手动添加以便追踪迁移进度。
                  </Text>
                  <List type="bullet">
                    <List.Item>前往 Shopify 后台 → 设置 → 结账 → 附加脚本</List.Item>
                    <List.Item>查看「附加脚本」或升级提示中列出的项目</List.Item>
                    <List.Item>对照本清单，添加缺失的项目</List.Item>
                  </List>
                  <Button onClick={() => setShowAddModal(true)}>+ 添加项目</Button>
                </BlockStack>
              </Box>
            </Collapsible>
          </BlockStack>
          <Divider />
          <InlineStack gap="200" align="end">
            <Button onClick={onExportChecklist} icon={ClipboardIcon}>
              导出清单
            </Button>
            {pendingCount > 0 && (
              <Button variant="primary" onClick={() => items.forEach((i) => onItemConfirm(i.id, true))}>
                {`全部确认 (${pendingCount})`}
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="添加迁移项目"
        primaryAction={{
          content: "添加",
          onAction: handleAddItem,
          disabled: !newItemName.trim(),
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowAddModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="项目名称"
              value={newItemName}
              onChange={setNewItemName}
              placeholder="例如：Google Ads 转化代码"
              autoComplete="off"
            />
            <BlockStack gap="200">
              <Text as="span" variant="bodySm">
                类型
              </Text>
              <InlineStack gap="200" wrap>
                {(["additional_script", "script_tag", "checkout_liquid", "other"] as const).map((type) => (
                  <Button key={type} pressed={newItemType === type} onClick={() => setNewItemType(type)} size="slim">
                    {getTypeLabel(type)}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
            <TextField
              label="备注（可选）"
              value={newItemNotes}
              onChange={setNewItemNotes}
              placeholder="例如：用于 remarketing，需要保留"
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title="从 Shopify 获取迁移清单"
        primaryAction={{
          content: "知道了",
          onAction: () => setShowGuideModal(false),
        }}
        secondaryActions={[
          {
            content: "打开 Shopify 设置",
            url: shopifyUpgradeUrl,
            external: true,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                Shopify API 无法直接读取 Additional Scripts 的内容。 以下步骤帮助您手动获取完整的迁移清单。
              </Text>
            </Banner>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                步骤 1: 打开 Shopify 结账设置
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="100">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ExternalIcon} />
                  <Text as="span" variant="bodySm">
                    设置 → 结账 → 附加脚本
                  </Text>
                </InlineStack>
              </Box>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                步骤 2: 查看升级提示
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                如果您的店铺有升级提示，Shopify 会列出受影响的脚本。 记录下这些项目名称。
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                步骤 3: 复制脚本内容（可选）
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                如需详细分析，可以复制 Additional Scripts 中的代码， 粘贴到扫描页面的「手动分析」标签页中。
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                步骤 4: 添加到迁移清单
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                对照 Shopify 列出的项目，在本页面点击「添加项目」 将缺失的脚本添加到迁移清单中。
              </Text>
            </BlockStack>
            <Divider />
            {shopTier === "plus" && (
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <strong>Plus 商家提醒：</strong>您还可以检查 checkout.liquid 文件中的自定义代码。
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

export default MigrationChecklist;
