import { useState, useEffect, useCallback } from "react";
import { useLoaderData, useSubmit, useActionData, useNavigation, useSearchParams } from "@remix-run/react";
import { Page, BlockStack, Banner, Tabs, Button, InlineStack, Text } from "@shopify/polaris";
import { PageIntroCard } from "~/components/layout/PageIntroCard";
import { useToastContext } from "~/components/ui";

import { settingsLoader } from "./loader.server";
import { settingsAction } from "./actions.server";
import type { SettingsActionResponse } from "./types";
import {
  SecurityTab,
  SubscriptionTab,
} from "./_components";
import type { PlanId } from "~/services/billing/plans";

export const loader = settingsLoader;
export const action = settingsAction;

export default function SettingsPage() {
  const { shop, hmacSecurityStats, pixelStrictOrigin } =
    useLoaderData<typeof settingsLoader>();
  const actionData = useActionData<SettingsActionResponse>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        showSuccess(actionData.message || "设置已保存");
      } else if (actionData.error) {
        showError(actionData.error);
      }
    }
  }, [actionData, showSuccess, showError]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const getTabIndex = (tab: string | null): number => {
    if (tab === "billing" || tab === "subscription") return 1;
    if (tab === "security") return 0;
    return 0;
  };
  const getTabId = (index: number): string => {
    if (index === 0) return "security";
    if (index === 1) return "subscription";
    return "security";
  };
  const [selectedTab, setSelectedTab] = useState(() => getTabIndex(tabParam));
  useEffect(() => {
    const newTabIndex = getTabIndex(tabParam);
    setSelectedTab(newTabIndex);
  }, [tabParam]);
  const handleTabChange = useCallback((index: number) => {
    const tabId = getTabId(index);
    setSearchParams({ tab: tabId });
  }, [setSearchParams]);
  const handleRotateSecret = useCallback(() => {
    const formData = new FormData();
    formData.append("_action", "rotateIngestionSecret");
    submit(formData, { method: "post" });
  }, [submit]);
  const isSubmitting = navigation.state === "submitting";
  const tabs = [
    { id: "security", content: "安全与隐私" },
    { id: "subscription", content: "订阅计划" },
  ];
  return (
    <Page title="设置">
      <BlockStack gap="500">
        <PageIntroCard
          title="设置总览"
          description="配置安全与隐私策略，以及订阅计划。"
          items={[
            "订阅管理与计费：在「订阅计划」标签页配置，或直接访问「订阅与计费」页面（推荐）",
            "数据保留与隐私策略在「安全与隐私」标签页",
            "隐私政策与 GDPR 请求在「隐私」页面",
          ]}
          primaryAction={{ content: "订阅与计费", url: "/app/billing" }}
          secondaryAction={{ content: "隐私设置", url: "/app/privacy" }}
        />
        <Banner tone="warning" title="重要功能快速访问">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              以下功能可通过左侧导航菜单或下方按钮直接访问
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/billing" variant="primary" size="large">
                订阅与计费
              </Button>
              <Button url="/app/privacy" variant="secondary" size="large">
                隐私设置
              </Button>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              订阅与计费用于管理您的付费计划和账单，隐私设置用于配置数据保护和合规选项。
            </Text>
          </BlockStack>
        </Banner>
        <Banner tone="info" title="订阅与计费管理">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              管理您的订阅计划、查看账单历史、升级或降级套餐。您可以在「订阅计划」标签页中查看当前计划详情，或直接访问「订阅与计费」页面进行更详细的管理。
            </Text>
            <InlineStack gap="200">
              <Button url="/app/billing" variant="primary">
                前往订阅与计费页面
              </Button>
              <Button onClick={() => handleTabChange(1)} variant="secondary">
                查看订阅计划标签页
              </Button>
            </InlineStack>
          </BlockStack>
        </Banner>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
          {selectedTab === 0 && (
            <SecurityTab
              shop={shop}
              isSubmitting={isSubmitting}
              onRotateSecret={handleRotateSecret}
              hmacSecurityStats={hmacSecurityStats}
              pixelStrictOrigin={pixelStrictOrigin}
            />
          )}
          {selectedTab === 1 && <SubscriptionTab currentPlan={shop?.plan as PlanId || "free"} />}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
