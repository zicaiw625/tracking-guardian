import {
  Modal,
  BlockStack,
  Text,
  List,
  Banner,
  Button,
  Divider,
} from "@shopify/polaris";
import { ManualInputWizard, type ManualInputData } from "~/components/scan/ManualInputWizard";
import { GuidedSupplement } from "~/components/scan/GuidedSupplement";
import { getDateDisplayLabel, DEPRECATION_DATES } from "~/utils/deprecation-dates";
import { useTranslation, Trans } from "react-i18next";

export interface ScanPageModalsProps {
  guidanceModalOpen: boolean;
  guidanceContent: { title: string; platform?: string; scriptTagId?: number } | null;
  closeGuidanceModal: () => void;
  deleteModalOpen: boolean;
  pendingDelete: { type: "webPixel"; id: string; gid: string; title: string } | null;
  deleteError: string | null;
  isDeleting: boolean;
  closeDeleteModal: () => void;
  confirmDelete: () => void;
  manualInputWizardOpen: boolean;
  setManualInputWizardOpen: (open: boolean) => void;
  handleManualInputComplete: (data: ManualInputData) => Promise<void>;
  guidedSupplementOpen: boolean;
  setGuidedSupplementOpen: (open: boolean) => void;
  shopId: string;
  showSuccess: (message: string) => void;
}

export function ScanPageModals({
  guidanceModalOpen,
  guidanceContent,
  closeGuidanceModal,
  deleteModalOpen,
  pendingDelete,
  deleteError,
  isDeleting,
  closeDeleteModal,
  confirmDelete,
  manualInputWizardOpen,
  setManualInputWizardOpen,
  handleManualInputComplete,
  guidedSupplementOpen,
  setGuidedSupplementOpen,
  shopId,
  showSuccess,
}: ScanPageModalsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Modal
        open={guidanceModalOpen}
        onClose={closeGuidanceModal}
        title={guidanceContent?.title || t("ScanModals.Guidance.Title")}
        primaryAction={{
          content: t("ScanModals.Guidance.GotIt"),
          onAction: closeGuidanceModal,
        }}
        secondaryActions={[
          {
            content: t("ScanModals.Guidance.GoToMigration"),
            url: `/app/migrate${guidanceContent?.platform ? `?platform=${guidanceContent.platform}` : ""}`,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {guidanceContent?.title?.includes("升级向导") ? (
              <>
                <Text as="p" variant="bodyMd">
                  {t("ScanModals.Guidance.UpgradeWizardContent")}
                </Text>
                <List type="number">
                  <List.Item>
                    <Text as="span" fontWeight="semibold">{t("ScanModals.Guidance.Step1")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("ScanModals.Guidance.Step1Desc")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">{t("ScanModals.Guidance.Step2")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("ScanModals.Guidance.Step2Desc")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">{t("ScanModals.Guidance.Step3")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("ScanModals.Guidance.Step3Desc")}
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">{t("ScanModals.Guidance.Step4")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("ScanModals.Guidance.Step4Desc")}
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("ScanModals.Guidance.Tip")}
                  </Text>
                </Banner>
                <Button
                  url="https://help.shopify.com/en/manual/pixels/customer-events"
                  external
                  variant="primary"
                >
                  {t("ScanModals.Guidance.OpenDocs")}
                </Button>
              </>
            ) : (
              <>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    {t("ScanModals.Guidance.LimitWarning")}
                  </Text>
                </Banner>
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">{t("ScanModals.Guidance.Steps.Title")}</Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span">
                        <strong>{t("ScanModals.Guidance.Steps.Pixel")}</strong>：在「迁移」页面确认 Tracking Guardian Pixel 已安装并正常运行
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>{t("ScanModals.Guidance.Steps.Creds")}</strong>：在「迁移」页面配置相应平台的像素 ID（GA4/Meta/TikTok）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>{t("ScanModals.Guidance.Steps.Verify")}</strong>：完成一次测试订单，在「监控」页面确认事件已收到
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>{t("ScanModals.Guidance.Steps.Delete")}</strong>：前往 Shopify 后台 → 设置 → 应用和销售渠道，找到创建该 ScriptTag 的应用并卸载
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">{t("ScanModals.Guidance.NotFound")}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("ScanModals.Guidance.NotFoundDesc")}
                  </Text>
                  <List type="bullet">
                    <List.Item>
                      {t("ScanModals.Guidance.NotFoundOptions.Contact", { id: guidanceContent?.scriptTagId })}
                    </List.Item>
                    <List.Item>
                      {t("ScanModals.Guidance.NotFoundOptions.API")}
                    </List.Item>
                    <List.Item>
                      {t("ScanModals.Guidance.NotFoundOptions.Expire", {
                        plusDate: getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact"),
                        nonPlusDate: getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")
                      })}
                    </List.Item>
                  </List>
                </BlockStack>
                {guidanceContent?.platform && (
                  <>
                    <Divider />
                    <Banner tone="success">
                      <Text as="p" variant="bodySm">
                        <Trans 
                          i18nKey="ScanModals.Guidance.SafeDelete"
                          values={{ platform: guidanceContent.platform }}
                        />
                      </Text>
                    </Banner>
                  </>
                )}
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title={t("ScanModals.Delete.Title")}
        primaryAction={{
          content: t("ScanModals.Delete.Confirm"),
          destructive: true,
          onAction: confirmDelete,
          loading: isDeleting,
          disabled: isDeleting,
        }}
        secondaryActions={[
          {
            content: t("ScanModals.Delete.Cancel"),
            onAction: closeDeleteModal,
            disabled: isDeleting,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              <Trans 
                i18nKey="ScanModals.Delete.Content"
                values={{ title: pendingDelete?.title }}
              />
            </Text>
            {deleteError && (
              <Banner tone="critical">
                <Text as="p" variant="bodySm">
                  {deleteError}
                </Text>
              </Banner>
            )}
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                {t("ScanModals.Delete.Warning")}
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <ManualInputWizard
        open={manualInputWizardOpen}
        onClose={() => setManualInputWizardOpen(false)}
        onComplete={handleManualInputComplete}
      />
      <GuidedSupplement
        open={guidedSupplementOpen}
        onClose={() => setGuidedSupplementOpen(false)}
        onComplete={(count) => {
          showSuccess(`成功创建 ${count} 个迁移资产`);
          window.location.reload();
        }}
        shopId={shopId}
      />
    </>
  );
}
