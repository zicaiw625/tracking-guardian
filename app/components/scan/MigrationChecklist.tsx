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
import {
  CheckCircleIcon,
  ClipboardIcon,
  InfoIcon,
  ExternalIcon,
} from "../icons";
import { useTranslation, Trans } from "react-i18next";

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

  const getMigrationTypeLabel = (type: MigrationItem["suggestedMigration"]) => {
    switch (type) {
      case "web_pixel":
        return t("scanPage.checklist.item.migrationType.web_pixel");
      case "ui_extension":
        return t("scanPage.checklist.item.migrationType.ui_extension");
      case "server_side":
        return t("scanPage.checklist.item.migrationType.server_side");
      case "none":
        return t("scanPage.checklist.item.migrationType.none");
      default:
        return t("scanPage.checklist.item.migrationType.pending");
    }
  };

  const getRiskBadge = (level: MigrationItem["riskLevel"]) => {
    switch (level) {
      case "high":
        return <Badge tone="critical">{t("dashboard.riskScore.high")}</Badge>;
      case "medium":
        return <Badge tone="warning">{t("dashboard.riskScore.medium")}</Badge>;
      case "low":
        return <Badge tone="success">{t("dashboard.riskScore.low")}</Badge>;
    }
  };

  const getTypeLabel = (type: MigrationItem["type"]) => {
    switch (type) {
      case "script_tag":
        return t("scanPage.checklist.item.type.script_tag");
      case "additional_script":
        return t("scanPage.checklist.item.type.additional_script");
      case "checkout_liquid":
        return t("scanPage.checklist.item.type.checkout_liquid");
      case "app_pixel":
        return t("scanPage.checklist.item.type.app_pixel");
      case "other":
        return t("scanPage.checklist.item.type.other");
    }
  };

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
                  {t("scanPage.checklist.title")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("scanPage.checklist.subtitle")}
                </Text>
              </BlockStack>
              <InlineStack gap="200">
                <Badge tone={confirmedCount === items.length ? "success" : "attention"}>
                  {t("scanPage.checklist.confirmedCount", { confirmed: confirmedCount, total: items.length })}
                </Badge>
                {highRiskCount > 0 && (
                  <Badge tone="critical">{t("scanPage.checklist.highRiskCount", { count: highRiskCount })}</Badge>
                )}
              </InlineStack>
            </InlineStack>
            {items.length > 0 && (
              <BlockStack gap="200">
                <ProgressBar progress={progressPercent} tone="primary" size="small" />
                <InlineStack gap="400" align="space-between">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {t("scanPage.checklist.progress", { percent: progressPercent })}
                  </Text>
                  {totalEstimatedMinutes > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("scanPage.checklist.estimatedTotalTime", { 
                        time: totalEstimatedHours > 0
                          ? `${totalEstimatedHours} ${t("scanPage.checklist.hours")} ${totalEstimatedMinutes % 60} ${t("scanPage.checklist.minutes")}`
                          : `${totalEstimatedMinutes} ${t("scanPage.checklist.minutes")}`
                      })}
                    </Text>
                  )}
                </InlineStack>
              </BlockStack>
            )}
          </BlockStack>
          <Divider />
          <Banner
            title={t("scanPage.checklist.guideBanner.title")}
            tone="info"
            action={{
              content: t("scanPage.checklist.guideBanner.action"),
              onAction: () => setShowGuideModal(true),
            }}
          >
            <Text as="p" variant="bodySm">
              {t("scanPage.checklist.guideBanner.content")}
            </Text>
          </Banner>
          <BlockStack gap="300">
            {items.length === 0 ? (
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200" align="center">
                  <Icon source={CheckCircleIcon} tone="success" />
                  <Text as="p">{t("scanPage.checklist.empty.title")}</Text>
                  <Button onClick={() => setShowAddModal(true)} size="slim">
                    {t("scanPage.checklist.empty.action")}
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
                              • {t("dashboard.riskScore.minutes", { count: item.estimatedTimeMinutes })}
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
                                ? t("scanPage.checklist.item.status.completed")
                                : item.migrationStatus === "in_progress"
                                  ? t("scanPage.checklist.item.status.in_progress")
                                  : t("scanPage.checklist.item.status.pending")}
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
                        ? t("scanPage.checklist.item.source.api_scan")
                        : item.source === "manual_paste"
                          ? t("scanPage.checklist.item.source.manual_paste")
                          : t("scanPage.checklist.item.source.merchant_confirmed")}
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
                <Text as="span">{t("scanPage.checklist.manualAdd.title")}</Text>
                <Text as="span" tone="subdued">
                  {manualExpanded ? t("scanPage.checklist.manualAdd.collapse") : t("scanPage.checklist.manualAdd.expand")}
                </Text>
              </InlineStack>
            </div>
            <Collapsible open={manualExpanded} id="manual-section">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm">
                    {t("scanPage.checklist.manualAdd.description")}
                  </Text>
                  <List type="bullet">
                    <List.Item>{t("scanPage.checklist.manualAdd.step1")}</List.Item>
                    <List.Item>{t("scanPage.checklist.manualAdd.step2")}</List.Item>
                    <List.Item>{t("scanPage.checklist.manualAdd.step3")}</List.Item>
                  </List>
                  <Button onClick={() => setShowAddModal(true)}>
                    {t("scanPage.checklist.manualAdd.action")}
                  </Button>
                </BlockStack>
              </Box>
            </Collapsible>
          </BlockStack>
          <Divider />
          <InlineStack gap="200" align="end">
            <Button onClick={onExportChecklist} icon={ClipboardIcon}>
              {t("scanPage.checklist.export")}
            </Button>
            {pendingCount > 0 && (
              <Button
                variant="primary"
                onClick={() => items.forEach((i) => onItemConfirm(i.id, true))}
              >
                {t("scanPage.checklist.confirmAll", { count: pendingCount })}
              </Button>
            )}
          </InlineStack>
        </BlockStack>
      </Card>
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t("scanPage.checklist.modal.addTitle")}
        primaryAction={{
          content: t("scanPage.checklist.modal.add"),
          onAction: handleAddItem,
          disabled: !newItemName.trim(),
        }}
        secondaryActions={[
          {
            content: t("scanPage.checklist.modal.cancel"),
            onAction: () => setShowAddModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={t("scanPage.checklist.modal.nameLabel")}
              value={newItemName}
              onChange={setNewItemName}
              placeholder={t("scanPage.checklist.modal.namePlaceholder")}
              autoComplete="off"
            />
            <BlockStack gap="200">
              <Text as="span" variant="bodySm">{t("scanPage.checklist.modal.typeLabel")}</Text>
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
              label={t("scanPage.checklist.modal.notesLabel")}
              value={newItemNotes}
              onChange={setNewItemNotes}
              placeholder={t("scanPage.checklist.modal.notesPlaceholder")}
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={showGuideModal}
        onClose={() => setShowGuideModal(false)}
        title={t("scanPage.checklist.guideModal.title")}
        primaryAction={{
          content: t("scanPage.checklist.guideModal.gotIt"),
          onAction: () => setShowGuideModal(false),
        }}
        secondaryActions={[
          {
            content: t("scanPage.checklist.guideModal.openSettings"),
            url: shopifyUpgradeUrl,
            external: true,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                {t("scanPage.checklist.guideModal.banner")}
              </Text>
            </Banner>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("scanPage.checklist.guideModal.step1")}
              </Text>
              <Box background="bg-surface-secondary" padding="300" borderRadius="100">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ExternalIcon} />
                  <Text as="span" variant="bodySm">
                    {t("scanPage.checklist.guideModal.step1Desc")}
                  </Text>
                </InlineStack>
              </Box>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("scanPage.checklist.guideModal.step2")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scanPage.checklist.guideModal.step2Desc")}
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("scanPage.checklist.guideModal.step3")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scanPage.checklist.guideModal.step3Desc")}
              </Text>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">
                {t("scanPage.checklist.guideModal.step4")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scanPage.checklist.guideModal.step4Desc")}
              </Text>
            </BlockStack>
            <Divider />
            {shopTier === "plus" && (
              <Banner tone="warning">
                <Text as="p" variant="bodySm">
                  <Trans i18nKey="scanPage.checklist.guideModal.plusWarning" components={{ strong: <strong /> }} />
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
