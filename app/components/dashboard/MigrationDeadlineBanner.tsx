import { Banner, BlockStack, Text, Link } from "@shopify/polaris";
import { formatDeadlineDate, DEPRECATION_DATES, SHOPIFY_HELP_LINKS } from "~/utils/migration-deadlines";

export function MigrationDeadlineBanner({ scriptTagsCount }: { scriptTagsCount: number }) {
  const plusDeadline = formatDeadlineDate(DEPRECATION_DATES.plusScriptTagExecutionOff, "exact");
  const plusAutoUpgrade = formatDeadlineDate(DEPRECATION_DATES.plusAutoUpgradeStart, "month");
  const nonPlusDeadline = formatDeadlineDate(DEPRECATION_DATES.nonPlusScriptTagExecutionOff, "exact");
  return (
    <Banner
      title="重要迁移截止日期"
      tone={scriptTagsCount > 0 ? "warning" : "info"}
      action={{
        content: "了解更多",
        url: SHOPIFY_HELP_LINKS.UPGRADE_GUIDE,
        external: true,
      }}
    >
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          <strong>重要提示：</strong>以下日期来自 Shopify 官方公告，仅供参考。实际截止日期请以 Shopify Admin 中的提示为准。Shopify 可能会更新策略，我们建议您定期查看 Shopify 官方文档。
        </Text>
        <BlockStack gap="100">
          <Text as="p">
            <strong>Plus 商家:</strong> <strong>{plusDeadline}</strong> 开始限制（ScriptTag 停止执行；Additional Scripts 进入只读模式（不可编辑，PII 不可访问），关键节点：升级/限制开始），<strong>{plusAutoUpgrade}</strong> 起 Shopify 开始自动升级（legacy 定制会丢失）。参考 <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
              external
            >
              查看 Plus 商家升级指南
            </Link>
          </Text>
        </BlockStack>
        <BlockStack gap="100">
          <Text as="p">
            <strong>非 Plus 商家:</strong> 最晚 <strong>{nonPlusDeadline}</strong> 截止。参考 <Link url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE} external>Shopify Help Center</Link>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            <Link
              url={SHOPIFY_HELP_LINKS.UPGRADE_GUIDE}
              external
            >
              查看 ScriptTags 弃用时间表
            </Link>
          </Text>
        </BlockStack>
        <Text as="p" tone="subdued">
          checkout.liquid、附加脚本（Additional Scripts）、ScriptTags 将逐步下线，建议尽早迁移到 Web
          Pixels
        </Text>
      </BlockStack>
    </Banner>
  );
}
