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
import { useT } from "~/context/LocaleContext";

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
  const t = useT();
  return (
    <>
      <Modal
        open={guidanceModalOpen}
        onClose={closeGuidanceModal}
        title={guidanceContent?.title || "ScriptTag 清理指南"}
        primaryAction={{
          content: "我知道了",
          onAction: closeGuidanceModal,
        }}
        secondaryActions={[
          {
            content: "前往迁移工具",
            url: `/app/migrate${guidanceContent?.platform ? `?platform=${guidanceContent.platform}` : ""}`,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {guidanceContent?.title?.includes("升级向导") ? (
              <>
                <Text as="p" variant="bodyMd">
                  您可以从 Shopify Admin 的升级向导中获取脚本清单，然后手动补充到扫描报告中。
                </Text>
                <List type="number">
                  <List.Item>
                    <Text as="span" fontWeight="semibold">访问升级向导</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      在 Shopify Admin 中，前往「设置」→「结账和订单处理」→「Thank you / Order status 页面升级」
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">查看脚本清单</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      升级向导会显示当前使用的 Additional Scripts 和 ScriptTags 列表
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">复制脚本内容</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      对于每个脚本，复制其完整内容（包括 URL 或内联代码）
                    </Text>
                  </List.Item>
                  <List.Item>
                    <Text as="span" fontWeight="semibold">粘贴到本页面</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      返回本页面，在「脚本内容分析」标签页中粘贴脚本内容，点击「分析脚本」进行识别
                    </Text>
                  </List.Item>
                </List>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    💡 提示：如果升级向导中显示的脚本较多，建议分批粘贴和分析，避免一次性处理过多内容。
                  </Text>
                </Banner>
                <Button
                  url="https://help.shopify.com/en/manual/pixels/customer-events"
                  external
                  variant="primary"
                >
                  打开 Shopify 升级向导帮助文档
                </Button>
              </>
            ) : (
              <>
                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    由于 Shopify 权限限制，应用无法直接删除 ScriptTag。
                    请按照以下步骤手动清理，或等待原创建应用自动处理。
                  </Text>
                </Banner>
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">推荐清理步骤：</Text>
                  <List type="number">
                    <List.Item>
                      <Text as="span">
                        <strong>确认 Web Pixel 已启用</strong>：在「迁移」页面确认 Tracking Guardian Pixel 已安装并正常运行
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>配置像素凭证</strong>：在「迁移」页面配置相应平台的像素 ID（GA4/Meta/TikTok）
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>验证追踪正常</strong>：完成一次测试订单，在「监控」页面确认事件已收到
                      </Text>
                    </List.Item>
                    <List.Item>
                      <Text as="span">
                        <strong>手动删除 ScriptTag</strong>：前往 Shopify 后台 → 设置 → 应用和销售渠道，找到创建该 ScriptTag 的应用并卸载
                      </Text>
                    </List.Item>
                  </List>
                </BlockStack>
                <Divider />
                <BlockStack gap="200">
                  <Text as="p" fontWeight="semibold">找不到创建应用？</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    如果 ScriptTag 是由已卸载的应用创建的残留数据，您可以：
                  </Text>
                  <List type="bullet">
                    <List.Item>联系 Shopify 支持，提供 ScriptTag ID: {guidanceContent?.scriptTagId}</List.Item>
                    <List.Item>使用 Shopify GraphQL API 手动删除（需开发者权限）</List.Item>
                    <List.Item>等待 ScriptTag 自动过期（Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）停止执行，非 Plus 商家将于 {getDateDisplayLabel(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）停止执行）</List.Item>
                  </List>
                </BlockStack>
                {guidanceContent?.platform && (
                  <>
                    <Divider />
                    <Banner tone="success">
                      <Text as="p" variant="bodySm">
                        💡 安装 Tracking Guardian 的 Web Pixel 后，旧的 {guidanceContent.platform} ScriptTag 可以安全删除，
                        因为 Web Pixel 标准事件映射将接管所有转化追踪功能（v1 最小可用迁移）。
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
        title="确认删除"
        primaryAction={{
          content: "确认删除",
          destructive: true,
          onAction: confirmDelete,
          loading: isDeleting,
          disabled: isDeleting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: closeDeleteModal,
            disabled: isDeleting,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              您确定要删除 <strong>{pendingDelete?.title}</strong> 吗？
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
                此操作不可撤销。删除后，相关追踪功能将立即停止。
                请确保您已通过其他方式配置了替代追踪方案。
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
          showSuccess(t("scan.migrateAssetsCreated", { count }));
          window.location.reload();
        }}
        shopId={shopId}
      />
    </>
  );
}
