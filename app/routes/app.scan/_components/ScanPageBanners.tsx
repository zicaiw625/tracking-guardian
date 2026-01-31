import { BlockStack, Banner, Text, Button, List } from "@shopify/polaris";
import { getDateDisplayLabel, DEPRECATION_DATES } from "~/utils/deprecation-dates";
import { getUpgradeBannerTone } from "~/components/scan";
import { parseDateSafely } from "~/utils/scan-validation";
import { useLocale, useT } from "~/context/LocaleContext";

export interface ScanPageBannersProps {
  deprecationStatus: unknown;
  onShowUpgradeGuide: () => void;
  scannerMaxScriptTags: number;
  scannerMaxWebPixels: number;
  partialRefresh: boolean;
  upgradeStatus: {
    autoUpgradeInfo?: { isInAutoUpgradeWindow?: boolean; autoUpgradeMessage?: string };
    title?: string;
    message?: string;
    urgency?: string;
    actions?: string[];
    lastUpdated?: string | null;
    hasOfficialSignal?: boolean;
  } | null;
  planId: string | null;
  planLabel: string | null;
  planTagline: string | null;
  isGrowthOrAbove: boolean;
  isProOrAbove: boolean;
  isAgency: boolean;
}

export function ScanPageBanners({
  deprecationStatus,
  onShowUpgradeGuide,
  scannerMaxScriptTags,
  scannerMaxWebPixels,
  partialRefresh,
  upgradeStatus,
  planId,
  planLabel,
  planTagline,
  isGrowthOrAbove,
  isProOrAbove,
  isAgency,
}: ScanPageBannersProps) {
  const dep = deprecationStatus as { additionalScripts?: { badge?: { text: string }; description?: string } } | null;
  const { locale, t } = useLocale();
  const dateLocale = locale === "zh" ? "zh-CN" : "en";
  return (
    <>
      <Banner tone="warning" title="Additional Scripts 需手动粘贴">
        <BlockStack gap="200">
          <Text as="p">
            Shopify API 无法读取 checkout.liquid / Additional Scripts。请在下方「脚本内容分析」中粘贴原始脚本，确保迁移报告涵盖 Thank you / Order status 页的自定义逻辑。
          </Text>
          {dep?.additionalScripts && (
            <Text as="p" tone="subdued">
              截止提醒：{dep.additionalScripts.badge?.text ?? ""} — {dep.additionalScripts.description ?? ""}
            </Text>
          )}
          <Button size="slim" variant="plain" onClick={onShowUpgradeGuide}>
            📋 查看获取脚本清单的详细步骤
          </Button>
        </BlockStack>
      </Banner>
      <Banner tone="info" title="扫描分页说明">
        <BlockStack gap="200">
          <Text as="p">
            Shopify API 结果是分页的。本扫描会自动迭代页面，但为了性能会在以下阈值停止并提示：
          </Text>
          <List type="bullet">
            <List.Item>ScriptTags 最多处理 {scannerMaxScriptTags.toLocaleString()} 条记录</List.Item>
            <List.Item>Web Pixel 最多处理 {scannerMaxWebPixels.toLocaleString()} 条记录</List.Item>
          </List>
          <Text as="p" tone="subdued">
            如果商店超过以上数量，请在「手动分析」中粘贴剩余脚本，或联系支持获取完整导出（当前上限可调整，请联系我们）。
          </Text>
        </BlockStack>
      </Banner>
      {partialRefresh && (
        <Banner tone="warning" title="部分数据刷新失败">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              扫描使用了缓存数据，但无法刷新 Web Pixels 信息。Web Pixels、重复像素检测和迁移操作建议可能不完整。
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              建议：点击「开始扫描」按钮重新执行完整扫描以获取最新数据。
            </Text>
          </BlockStack>
        </Banner>
      )}
      {upgradeStatus?.autoUpgradeInfo?.autoUpgradeMessage && (
        <Banner
          title={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "⚡ Plus 商家自动升级窗口已开始" : "⚠️ Plus 商家自动升级风险窗口"}
          tone={upgradeStatus.autoUpgradeInfo.isInAutoUpgradeWindow ? "critical" : "warning"}
        >
          <BlockStack gap="200">
            <Text as="p">{upgradeStatus.autoUpgradeInfo.autoUpgradeMessage}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              <strong>Shopify 官方升级路径：</strong>使用 blocks + web pixels 替代 legacy customizations。Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.plusAdditionalScriptsReadOnly, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）截止，{getDateDisplayLabel(DEPRECATION_DATES.plusAutoUpgradeStart, "month")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）自动升级会丢失 legacy 自定义。非 Plus 商家：{getDateDisplayLabel(DEPRECATION_DATES.nonPlusAdditionalScriptsReadOnly, "exact")}（日期来自 Shopify 官方公告，请以 Admin 提示为准）截止。
            </Text>
          </BlockStack>
        </Banner>
      )}
      {upgradeStatus?.title && upgradeStatus?.message && (
        <Banner title={upgradeStatus.title} tone={getUpgradeBannerTone(upgradeStatus.urgency ?? "info")}>
          <BlockStack gap="200">
            <Text as="p">{upgradeStatus.message}</Text>
            {(upgradeStatus.actions?.length ?? 0) > 0 && (
              <BlockStack gap="100">
                {upgradeStatus.actions!.map((action, idx) => (
                  <Text key={idx} as="p" variant="bodySm">
                    • {action}
                  </Text>
                ))}
              </BlockStack>
            )}
            {!upgradeStatus.hasOfficialSignal && (
              <Text as="p" variant="bodySm" tone="subdued">
                提示：我们尚未完成一次有效的升级状态检测。请稍后重试、重新授权应用，或等待后台定时任务自动刷新。
              </Text>
            )}
            {upgradeStatus.lastUpdated && parseDateSafely(upgradeStatus.lastUpdated) && (
              <Text as="p" variant="bodySm" tone="subdued">
                {t("scan.statusUpdatedAt")}: {parseDateSafely(upgradeStatus.lastUpdated)!.toLocaleString(dateLocale)}
              </Text>
            )}
          </BlockStack>
        </Banner>
      )}
      {planId && planLabel && (
        <Banner
          title={`当前套餐：${planLabel}`}
          tone={isGrowthOrAbove ? "info" : "warning"}
          action={{
            content: "查看套餐/升级",
            url: "/app/settings?tab=subscription",
          }}
        >
          <BlockStack gap="200">
            {planTagline && (
              <Text as="p" variant="bodySm">{planTagline}</Text>
            )}
            {!isGrowthOrAbove && (
              <List type="bullet">
                <List.Item><strong>启用像素迁移（Test 环境）</strong> → 进入付费试用/订阅（Starter $29/月）</List.Item>
                <List.Item>像素迁移功能包括：标准事件映射 + 参数完整率检查 + 可下载 payload 证据（GA4/Meta/TikTok v1 支持）</List.Item>
                <List.Item><strong>生成验收报告（CSV）</strong> → 付费（Growth $79/月 或 Agency $199/月）</List.Item>
                <List.Item>这是"升级项目交付"的核心能力：让商家"敢点发布/敢切 Live"</List.Item>
              </List>
            )}
            {isGrowthOrAbove && !isProOrAbove && (
              <List type="bullet">
                <List.Item>当前可用：Web Pixel 标准事件映射（v1 最小可用迁移）</List.Item>
                <List.Item>升级到 Pro 以解锁事件对账与高级告警能力</List.Item>
              </List>
            )}
            {isProOrAbove && !isAgency && (
              <List type="bullet">
                <List.Item>已解锁多渠道像素 + 事件对账</List.Item>
                <List.Item>多店铺、白标、团队协作即将在 v1.1 推出，可升级至 Agency 以在发布后使用</List.Item>
              </List>
            )}
            {isAgency && (
              <List type="bullet">
                <List.Item>多店铺、白标、团队协作即将在 v1.1 推出；当前已解锁无限像素、验收报告导出与 SLA</List.Item>
                <List.Item>如需迁移托管，可在支持渠道提交工单</List.Item>
              </List>
            )}
          </BlockStack>
        </Banner>
      )}
    </>
  );
}
