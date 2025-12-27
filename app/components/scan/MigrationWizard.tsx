import {
  Card,
  BlockStack,
  Box,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  List,
} from "@shopify/polaris";
import { ShareIcon, ArrowRightIcon, InfoIcon, ClipboardIcon, ExportIcon } from "~/components/icons";
import type { MigrationAction } from "../../services/scanner/types";
import { getPlatformName } from "./utils";

interface MigrationWizardProps {
  migrationActions: MigrationAction[];
  shopDomain?: string;
}

export function MigrationWizard({ migrationActions, shopDomain }: MigrationWizardProps) {
  const handleCopyChecklist = () => {
    const checklist = [
      "# 迁移清单",
      `店铺: ${shopDomain || "未知"}`,
      `生成时间: ${new Date().toLocaleString("zh-CN")}`,
      "",
      "## 待处理项目",
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${a.priority === "high" ? "高" : a.priority === "medium" ? "中" : "低"}] ${
            a.title
          }${a.platform ? ` (${a.platform})` : ""}`
      ) || ["无"]),
      "",
      "## 快速链接",
      "- Pixels 管理: https://admin.shopify.com/store/settings/customer_events",
      "- Checkout Editor: https://admin.shopify.com/store/settings/checkout/editor",
      "- 应用迁移工具: /app/migrate",
    ].join("\n");
    navigator.clipboard.writeText(checklist);
  };
  const handleExportChecklist = () => {
    const checklist = [
      "迁移清单",
      `店铺: ${shopDomain || "未知"}`,
      `生成时间: ${new Date().toLocaleString("zh-CN")}`,
      "",
      "待处理项目:",
      ...(migrationActions?.map(
        (a, i) =>
          `${i + 1}. [${
            a.priority === "high" ? "高优先级" : a.priority === "medium" ? "中优先级" : "低优先级"
          }] ${a.title}${a.platform ? ` (${a.platform})` : ""}`
      ) || ["无"]),
    ].join("\n");
    const blob = new Blob([checklist], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migration-checklist-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            🧭 迁移向导
          </Text>
          <Badge tone="info">P1-3 迁移闭环</Badge>
        </InlineStack>
        <Text as="p" tone="subdued">
          根据扫描结果，以下是完成迁移所需的步骤。点击各项可直接跳转到对应位置。
        </Text>
        <Divider />
        {}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            📦 Web Pixel 设置
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Web Pixel 是 Shopify 推荐的客户端追踪方式，替代传统 ScriptTag。
          </Text>
          <InlineStack gap="300" wrap>
            <Button
              url="https://admin.shopify.com/store/settings/customer_events"
              external
              icon={ShareIcon}
            >
              管理 Pixels（Shopify 后台）
            </Button>
            <Button url="/app/migrate" icon={ArrowRightIcon}>
              在应用内配置 Pixel
            </Button>
          </InlineStack>
        </BlockStack>
        <Divider />
        {}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            🛒 Checkout Editor（Plus 专属）
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            如果您是 Shopify Plus 商家，可以使用 Checkout UI Extension 替代 Additional Scripts。
          </Text>
          <InlineStack gap="300" wrap>
            <Button
              url="https://admin.shopify.com/store/settings/checkout/editor"
              external
              icon={ShareIcon}
            >
              打开 Checkout Editor
            </Button>
            <Button
              url="https://shopify.dev/docs/apps/checkout/thank-you-order-status"
              external
              icon={InfoIcon}
            >
              查看官方文档
            </Button>
          </InlineStack>
        </BlockStack>
        <Divider />
        {}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            📋 迁移清单
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            生成可导出的迁移步骤清单，方便团队协作或记录进度。
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="200">
              <Text as="p" fontWeight="semibold">
                待迁移项目：
              </Text>
              <List type="number">
                {migrationActions && migrationActions.length > 0 ? (
                  migrationActions.slice(0, 5).map((action, i) => (
                    <List.Item key={i}>
                      {action.title}
                      {action.platform && ` (${getPlatformName(action.platform)})`}
                      {action.priority === "high" && " ⚠️"}
                    </List.Item>
                  ))
                ) : (
                  <List.Item>暂无待处理项目 ✅</List.Item>
                )}
                {migrationActions && migrationActions.length > 5 && (
                  <List.Item>...还有 {migrationActions.length - 5} 项</List.Item>
                )}
              </List>
              <InlineStack gap="200" align="end">
                <Button icon={ClipboardIcon} onClick={handleCopyChecklist}>
                  复制清单
                </Button>
                <Button icon={ExportIcon} onClick={handleExportChecklist}>
                  导出清单
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </BlockStack>
        <Divider />
        {}
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">
            🔄 替代方案一览
          </Text>
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="300">
              <InlineStack gap="400" wrap>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="success">官方替代</Badge>
                    <Text as="p" variant="bodySm">
                      • Shopify Pixels（客户端）
                      <br />• Customer Events API
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="info">Web Pixel 替代</Badge>
                    <Text as="p" variant="bodySm">
                      • ScriptTag → Web Pixel
                      <br />• checkout.liquid → Pixel + Extension
                    </Text>
                  </BlockStack>
                </Box>
                <Box minWidth="200px">
                  <BlockStack gap="100">
                    <Badge tone="warning">UI Extension 替代</Badge>
                    <Text as="p" variant="bodySm">
                      • Additional Scripts → Checkout UI
                      <br />• Order Status 脚本 → TYP Extension
                    </Text>
                  </BlockStack>
                </Box>
              </InlineStack>
            </BlockStack>
          </Box>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
