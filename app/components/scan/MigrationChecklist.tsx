import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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
import {
  CheckCircleIcon,
  ClipboardIcon,
  InfoIcon,
  ExternalIcon,
} from "../icons";

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

export function MigrationChecklist({
  items,
  onItemConfirm,
  onAddManualItem,
  onExportChecklist,
  shopTier,
}: MigrationChecklistProps) {
  const { t } = useTranslation();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<MigrationItem["type"]>("additional_script");
  const [newItemNotes, setNewItemNotes] = useState("");

  const getMigrationTypeLabel = (type: MigrationItem["suggestedMigration"]) => {
    switch (type) {
      case "web_pixel":
        return "Web Pixel";
      case "ui_extension":
        return t("migrationChecklist.migrationType.uiExtension");
      case "server_side":
        return t("migrationChecklist.migrationType.serverSide");
      case "none":
        return "External redirect / not supported";
      default:
        return t("migrationChecklist.migrationType.unknown");
    }
  };

  const getRiskBadge = (level: MigrationItem["riskLevel"]) => {
    switch (level) {
      case "high":
        return <Badge tone="critical">{t("migrationChecklist.risk.high")}</Badge>;
      case "medium":
        return <Badge tone="warning">{t("migrationChecklist.risk.medium")}</Badge>;
      case "low":
        return <Badge tone="success">{t("migrationChecklist.risk.low")}</Badge>;
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
        return t("migrationChecklist.type.other");
    }
  };

  const confirmedCount = items.filter((i) => i.confirmed).length;
  const highRiskCount = items.filter((i) => i.riskLevel === "high").length;
  const pendingCount = items.filter((i) => !i.confirmed).length;
  const totalEstimatedMinutes = items
    .filter((i) => i.confirmed && i.estimatedTimeMinutes)
    .reduce((sum, i) => sum + (i.estimatedTimeMinutes || 0), 0);
  const totalEstimatedHours = Math.ceil(totalEstimatedMinutes / 60);
  const progressPercent = items.length > 0
    ? Math.round((confirmedCount / items.length) * 100)
    : 100;
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
  const shopifyUpgradeUrl = shopTier === "plus"
    ? "https://www.shopify.com/pricing"
    : "https://www.shopify.com/pricing"
  return (
    <>
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {t("migrationChecklist.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("migrationChecklist.subtitle")}
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Badge tone={confirmedCount === items.length ? "success" : "attention"}>
                  {t("migrationChecklist.confirmedCount", { confirmed: confirmedCount, total: items.length })}
                </Badge>
                {highRiskCount > 0 && (
                  <Badge tone="critical">{t("migrationChecklist.highRiskCount", { count: highRiskCount })}</Badge>
                )}
              </InlineStack>
            </InlineStack>
            {items.length > 0 && (
              <BlockStack gap="200">
                <ProgressBar progress={progressPercent} tone="primary" size="small" />
                <InlineStack gap="400" align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("migrationChecklist.progress", { percent: progressPercent })}
                  </Text>
                  {totalEstimatedMinutes > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {totalEstimatedHours > 0
                        ? t("migrationChecklist.estimatedTimeHoursMinutes", { hours: totalEstimatedHours, minutes: totalEstimatedMinutes % 60 })
                        : t("migrationChecklist.estimatedTimeMinutes", { minutes: totalEstimatedMinutes })}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
          <Divider />
          <Banner
            title={t("migrationChecklist.upgradeWizardTitle")}
            tone="info"
            action={{
              content: t("migrationChecklist.viewGuide"),
              onAction: () => setShowGuideModal(true),
            }}
          >
            <Text as="p" variant="bodySm">
              {t("migrationChecklist.upgradeWizardDescription")}
            </Text>
          </Banner>
          <BlockStack gap="300">
            {items.length === 0 ? (
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200" align="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="p">{t("migrationChecklist.noItems")}</Text>
                  <Button onClick={() => setShowAddModal(true)} size="slim">
                    {t("migrationChecklist.addManually")}
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
                              • {t("migrationChecklist.estimatedMinutes", { minutes: item.estimatedTimeMinutes })}
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
                                ? t("migrationChecklist.status.completed")
                                : item.migrationStatus === "in_progress"
                                  ? t("migrationChecklist.status.inProgress")
                                  : t("migrationChecklist.status.pending")}
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
                        item.source === "api_scan"
                          ? "info"
                          : item.source === "manual_paste"
                            ? "attention"
                            : "success"
                      }
                    >
                      {item.source === "api_scan"
                        ? t("migrationChecklist.source.apiScan")
                        : item.source === "manual_paste"
                          ? t("migrationChecklist.source.manualPaste")
                          : t("migrationChecklist.source.merchantConfirmed")}
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
              className="tg-migration-checklist-manual-toggle"
            >
              <InlineStack gap="200" blockAlign="center">
                <Icon source={InfoIcon} />
                <Text as="span">{t("migrationChecklist.manualSection.title")}</Text>
                <Text as="span" tone="subdued">
                  {manualExpanded ? t("migrationChecklist.collapse") : t("migrationChecklist.expand")}
                </Text>
              </InlineStack>
            </div>
            <Collapsible open={manualExpanded} id="manual-section">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm">
                    {t("migrationChecklist.manualSection.description")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("migrationChecklist.manualSection.step1")}</List.Item>
                    <List.Item>{t("migrationChecklist.manualSection.step2")}</List.Item>
                    <List.Item>{t("migrationChecklist.manualSection.step3")}</List.Item>
                  </List>
                  <Button onClick={() => setShowAddModal(true)}>
                    {t("migrationChecklist.addItem")}
                  </Button>
                </BlockStack>
              </Box>
            </Collapsible>
          </BlockStack>
          <Divider />
          <InlineStack gap="200" align="end">
            <Button onClick={onExportChecklist} icon={ClipboardIcon}>
              {t("migrationChecklist.exportChecklist")}
            </Button>
            {pendingCount > 0 && (
              <Button
                variant="primary"
                onClick={() => items.forEach((i) => onItemConfirm(i.id, true))}
              >
                {t("migrationChecklist.confirmAll", { count: pendingCount })}
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t("migrationChecklist.addModal.title")}
        primaryAction={{
          content: t("migrationChecklist.addModal.add"),
          onAction: handleAddItem,
          disabled: !newItemName.trim(),
        }}
        secondaryActions={[
          {
            content: t("migrationChecklist.addModal.cancel"),
            onAction: () => setShowAddModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={t("migrationChecklist.addModal.nameLabel")}
              value={newItemName}
              onChange={setNewItemName}
              placeholder={t("migrationChecklist.addModal.namePlaceholder")}
              autoComplete="off"
            />
            <BlockStack gap="200">
              <Text as="span" variant="bodySm">{t("migrationChecklist.addModal.typeLabel")}</Text>
              <InlineStack gap="200" wrap>
                {(["additional_script", "script_tag", "checkout_liquid", "other"] as const).map(
                  (type) => (
                    <Button
                      key={type}
                      pressed={newItemType === type}
                      onClick={() => setNewItemType(type)}
                      size="slim"
                    >
                      {getTypeLabel(type)}
                    </Button>
                  )
                )}
              </InlineStack>
            </BlockStack>
            <TextField
              label={t("migrationChecklist.addModal.notesLabel")}
              value={newItemNotes}
              onChange={setNewItemNotes}
              placeholder={t("migrationChecklist.addModal.notesPlaceholder")}
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title={t("migrationChecklist.guideModal.title")}
        primaryAction={{
          content: t("migrationChecklist.guideModal.gotIt"),
          onAction: () => setShowGuideModal(false),
        }}
        secondaryActions={[
          {
            content: t("migrationChecklist.guideModal.openSettings"),
            url: shopifyUpgradeUrl,
            external: true,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("migrationChecklist.guideModal.infoBanner")}
              </Text>
            </Banner>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("migrationChecklist.guideModal.step1Title")}
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="100">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ExternalIcon} />
                  <Text as="span" variant="bodySm">
                    {t("migrationChecklist.guideModal.step1Content")}
                  </Text>
                </InlineStack>
              </Box>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("migrationChecklist.guideModal.step2Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("migrationChecklist.guideModal.step2Content")}
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("migrationChecklist.guideModal.step3Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("migrationChecklist.guideModal.step3Content")}
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("migrationChecklist.guideModal.step4Title")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("migrationChecklist.guideModal.step4Content")}
              </Text>
            </BlockStack>
            <Divider />
            {shopTier === "plus" && (
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  {t("migrationChecklist.guideModal.plusWarning")}
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
