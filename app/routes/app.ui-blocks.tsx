/**
 * UI 模块配置页面
 * 对应设计方案 4.4 Thank you / Order status UI 模块库
 * 
 * 让商家可视化配置 Thank You / Order Status 页面的 UI 模块
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator } from "@remix-run/react";
import { useState, useCallback } from "react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Box,
  Divider,
  Banner,
  Tabs,
  TextField,
  Select,
  Checkbox,
  Modal,
  Icon,
  EmptyState,
  List,
  Collapsible,
  Tag,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  EditIcon,
  SettingsIcon,
  RefreshIcon,
} from "~/components/icons";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getUiModuleConfigs,
  updateUiModuleConfig,
  resetModuleToDefault,
  getEnabledModulesCount,
} from "../services/ui-extension.server";
import {
  UI_MODULES,
  type ModuleKey,
  type UiModuleConfig,
  type SurveySettings,
  type HelpdeskSettings,
  type ReorderSettings,
  type OrderTrackingSettings,
  type UpsellSettings,
  type LocalizationSettings,
} from "../types/ui-extension";
import { getPlanOrDefault, type PlanId, BILLING_PLANS } from "../services/billing/plans";

interface LoaderData {
  shop: {
    id: string;
    plan: PlanId;
  } | null;
  modules: UiModuleConfig[];
  enabledCount: number;
  maxModules: number;
  planInfo: typeof BILLING_PLANS[PlanId];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json<LoaderData>({
      shop: null,
      modules: [],
      enabledCount: 0,
      maxModules: 0,
      planInfo: BILLING_PLANS.free,
    });
  }

  const planId = shop.plan as PlanId;
  const planInfo = getPlanOrDefault(planId);
  const modules = await getUiModuleConfigs(shop.id);
  const enabledCount = await getEnabledModulesCount(shop.id);

  return json<LoaderData>({
    shop: { id: shop.id, plan: planId },
    modules,
    enabledCount,
    maxModules: planInfo.uiModules,
    planInfo,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }

  switch (actionType) {
    case "toggle_module": {
      const moduleKey = formData.get("moduleKey") as ModuleKey;
      const isEnabled = formData.get("isEnabled") === "true";

      const result = await updateUiModuleConfig(shop.id, moduleKey, { isEnabled });
      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true, actionType: "toggle_module", moduleKey, isEnabled });
    }

    case "update_settings": {
      const moduleKey = formData.get("moduleKey") as ModuleKey;
      const settingsJson = formData.get("settings") as string;
      const localizationJson = formData.get("localization") as string | null;
      
      try {
        const settings = JSON.parse(settingsJson);
        const localization = localizationJson ? JSON.parse(localizationJson) : undefined;
        const result = await updateUiModuleConfig(shop.id, moduleKey, { settings, localization });
        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }
        return json({ success: true, actionType: "update_settings", moduleKey });
      } catch {
        return json({ error: "无效的设置数据" }, { status: 400 });
      }
    }

    case "update_display_rules": {
      const moduleKey = formData.get("moduleKey") as ModuleKey;
      const displayRulesJson = formData.get("displayRules") as string;
      
      try {
        const displayRules = JSON.parse(displayRulesJson);
        const result = await updateUiModuleConfig(shop.id, moduleKey, { displayRules });
        if (!result.success) {
          return json({ error: result.error }, { status: 400 });
        }
        return json({ success: true, actionType: "update_display_rules", moduleKey });
      } catch {
        return json({ error: "无效的显示规则" }, { status: 400 });
      }
    }

    case "reset_module": {
      const moduleKey = formData.get("moduleKey") as ModuleKey;
      const result = await resetModuleToDefault(shop.id, moduleKey);
      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }
      return json({ success: true, actionType: "reset_module", moduleKey });
    }

    default:
      return json({ error: "未知操作" }, { status: 400 });
  }
};

// 模块卡片组件
function ModuleCard({
  module,
  onToggle,
  onEdit,
  isSubmitting,
  canEnable,
  upgradeRequired,
}: {
  module: UiModuleConfig;
  onToggle: (moduleKey: ModuleKey, enabled: boolean) => void;
  onEdit: (moduleKey: ModuleKey) => void;
  isSubmitting: boolean;
  canEnable: boolean;
  upgradeRequired?: PlanId;
}) {
  const info = UI_MODULES[module.moduleKey];
  
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Box
              background={module.isEnabled ? "bg-fill-success-secondary" : "bg-surface-secondary"}
              padding="200"
              borderRadius="full"
            >
              <Text as="span" variant="headingMd">
                {info.icon}
              </Text>
            </Box>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  {info.name}
                </Text>
                {module.isEnabled && (
                  <Badge tone="success">已启用</Badge>
                )}
                {upgradeRequired && !module.isEnabled && (
                  <Badge tone="attention">需要升级</Badge>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {info.description}
              </Text>
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200">
            {module.isEnabled && (
              <Button
                icon={EditIcon}
                onClick={() => onEdit(module.moduleKey)}
                size="slim"
              >
                配置
              </Button>
            )}
            <Button
              variant={module.isEnabled ? "secondary" : "primary"}
              onClick={() => onToggle(module.moduleKey, !module.isEnabled)}
              loading={isSubmitting}
              disabled={!canEnable && !module.isEnabled}
              size="slim"
            >
              {module.isEnabled ? "停用" : "启用"}
            </Button>
          </InlineStack>
        </InlineStack>

        {/* 显示位置标签 */}
        <InlineStack gap="100">
          {info.targets.map((target) => (
            <Tag key={target}>
              {target === "thank_you" ? "Thank You 页" : "订单状态页"}
            </Tag>
          ))}
          <Tag>{getCategoryLabel(info.category)}</Tag>
        </InlineStack>

        {/* 升级提示 */}
        {upgradeRequired && !module.isEnabled && (
          <Banner tone="warning">
            <Text as="p" variant="bodySm">
              此模块需要 {BILLING_PLANS[upgradeRequired].name} 或更高套餐。
              <Button url="/app/billing" variant="plain" size="slim">
                升级套餐
              </Button>
            </Text>
          </Banner>
        )}
      </BlockStack>
    </Card>
  );
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case "engagement":
      return "用户互动";
    case "support":
      return "客户支持";
    case "conversion":
      return "转化提升";
    default:
      return category;
  }
}

// 问卷设置表单
function SurveySettingsForm({
  settings,
  onChange,
}: {
  settings: SurveySettings;
  onChange: (settings: SurveySettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <TextField
        label="标题"
        value={settings.title || ""}
        onChange={(value) => onChange({ ...settings, title: value })}
        autoComplete="off"
      />
      <TextField
        label="问题"
        value={settings.question || ""}
        onChange={(value) => onChange({ ...settings, question: value })}
        autoComplete="off"
        helpText="例如：您是如何了解到我们的？"
      />
      <Checkbox
        label="显示评分选项"
        checked={settings.showRating !== false}
        onChange={(checked) => onChange({ ...settings, showRating: checked })}
      />
      {settings.showRating !== false && (
        <TextField
          label="评分标签"
          value={settings.ratingLabel || ""}
          onChange={(value) => onChange({ ...settings, ratingLabel: value })}
          autoComplete="off"
        />
      )}
      <Divider />
      <Text as="h4" variant="headingSm">
        选项配置
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        来源选项（逗号分隔）
      </Text>
      <TextField
        label="选项列表"
        value={settings.sources?.map((s) => s.label).join(", ") || ""}
        onChange={(value) => {
          const labels = value.split(",").map((l) => l.trim()).filter(Boolean);
          onChange({
            ...settings,
            sources: labels.map((label, i) => ({
              id: `option_${i}`,
              label,
            })),
          });
        }}
        autoComplete="off"
        multiline={2}
      />
    </BlockStack>
  );
}

// 帮助中心设置表单
function HelpdeskSettingsForm({
  settings,
  onChange,
}: {
  settings: HelpdeskSettings;
  onChange: (settings: HelpdeskSettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <TextField
        label="标题"
        value={settings.title || ""}
        onChange={(value) => onChange({ ...settings, title: value })}
        autoComplete="off"
      />
      <TextField
        label="描述"
        value={settings.description || ""}
        onChange={(value) => onChange({ ...settings, description: value })}
        autoComplete="off"
        multiline={2}
      />
      <Divider />
      <Text as="h4" variant="headingSm">
        链接配置
      </Text>
      <TextField
        label="FAQ 链接"
        value={settings.faqUrl || ""}
        onChange={(value) => onChange({ ...settings, faqUrl: value })}
        autoComplete="off"
        placeholder="/pages/faq"
      />
      <TextField
        label="联系邮箱"
        type="email"
        value={settings.contactEmail || ""}
        onChange={(value) => onChange({ ...settings, contactEmail: value })}
        autoComplete="off"
        placeholder="support@example.com"
      />
      <TextField
        label="联系页面链接"
        value={settings.contactUrl || ""}
        onChange={(value) => onChange({ ...settings, contactUrl: value })}
        autoComplete="off"
        placeholder="/pages/contact"
      />
      <TextField
        label="WhatsApp 号码"
        value={settings.whatsappNumber || ""}
        onChange={(value) => onChange({ ...settings, whatsappNumber: value })}
        autoComplete="off"
        placeholder="+8613800138000"
      />
      <TextField
        label="继续购物链接"
        value={settings.continueShoppingUrl || ""}
        onChange={(value) => onChange({ ...settings, continueShoppingUrl: value })}
        autoComplete="off"
        placeholder="/"
      />
    </BlockStack>
  );
}

// 再购设置表单
function ReorderSettingsForm({
  settings,
  onChange,
}: {
  settings: ReorderSettings;
  onChange: (settings: ReorderSettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <TextField
        label="标题"
        value={settings.title || ""}
        onChange={(value) => onChange({ ...settings, title: value })}
        autoComplete="off"
      />
      <TextField
        label="副标题"
        value={settings.subtitle || ""}
        onChange={(value) => onChange({ ...settings, subtitle: value })}
        autoComplete="off"
      />
      <TextField
        label="按钮文字"
        value={settings.buttonText || ""}
        onChange={(value) => onChange({ ...settings, buttonText: value })}
        autoComplete="off"
      />
      <Checkbox
        label="显示商品列表"
        checked={settings.showItems !== false}
        onChange={(checked) => onChange({ ...settings, showItems: checked })}
      />
      {settings.showItems !== false && (
        <Select
          label="最多显示商品数"
          options={[
            { label: "1 件", value: "1" },
            { label: "2 件", value: "2" },
            { label: "3 件", value: "3" },
            { label: "5 件", value: "5" },
          ]}
          value={String(settings.maxItemsToShow || 3)}
          onChange={(value) => onChange({ ...settings, maxItemsToShow: parseInt(value) })}
        />
      )}
    </BlockStack>
  );
}

// 物流追踪设置表单
function OrderTrackingSettingsForm({
  settings,
  onChange,
}: {
  settings: OrderTrackingSettings;
  onChange: (settings: OrderTrackingSettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <TextField
        label="标题"
        value={settings.title || ""}
        onChange={(value) => onChange({ ...settings, title: value })}
        autoComplete="off"
      />
      <Select
        label="物流追踪服务商"
        options={[
          { label: "Shopify 原生", value: "native" },
          { label: "AfterShip", value: "aftership" },
          { label: "17Track", value: "17track" },
        ]}
        value={settings.provider || "native"}
        onChange={(value) => onChange({ ...settings, provider: value as "native" | "aftership" | "17track" })}
      />
      {settings.provider && settings.provider !== "native" && (
        <TextField
          label="API Key"
          type="password"
          value={settings.apiKey || ""}
          onChange={(value) => onChange({ ...settings, apiKey: value })}
          autoComplete="off"
          helpText="输入服务商提供的 API Key"
        />
      )}
      <Checkbox
        label="显示预计送达时间"
        checked={settings.showEstimatedDelivery !== false}
        onChange={(checked) => onChange({ ...settings, showEstimatedDelivery: checked })}
      />
    </BlockStack>
  );
}

// 追加销售设置表单
function UpsellSettingsForm({
  settings,
  onChange,
}: {
  settings: UpsellSettings;
  onChange: (settings: UpsellSettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <TextField
        label="标题"
        value={settings.title || ""}
        onChange={(value) => onChange({ ...settings, title: value })}
        autoComplete="off"
      />
      <TextField
        label="副标题"
        value={settings.subtitle || ""}
        onChange={(value) => onChange({ ...settings, subtitle: value })}
        autoComplete="off"
      />
      <TextField
        label="折扣码"
        value={settings.discountCode || ""}
        onChange={(value) => onChange({ ...settings, discountCode: value })}
        autoComplete="off"
        helpText="可选：为推荐商品提供专属折扣码"
      />
      <TextField
        label="折扣百分比"
        type="number"
        value={String(settings.discountPercent || "")}
        onChange={(value) => onChange({ ...settings, discountPercent: parseInt(value) || undefined })}
        autoComplete="off"
        suffix="%"
      />
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          产品配置需要在 Shopify Admin 的 Checkout Editor 中设置。
          此处仅控制展示样式和折扣信息。
        </Text>
      </Banner>
    </BlockStack>
  );
}

// 常用语言列表
const COMMON_LOCALES = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
];

// 本地化设置表单
function LocalizationSettingsForm({
  localization,
  onChange,
  moduleKey,
}: {
  localization: LocalizationSettings | undefined;
  onChange: (localization: LocalizationSettings) => void;
  moduleKey: ModuleKey;
}) {
  const [selectedLocale, setSelectedLocale] = useState<string>("en");
  const currentLocaleData = localization?.[selectedLocale] || {};

  const handleFieldChange = (field: string, value: string) => {
    const updated = {
      ...localization,
      [selectedLocale]: {
        ...(localization?.[selectedLocale] || {}),
        [field]: value,
      },
    };
    onChange(updated);
  };

  // 根据模块类型显示不同的可翻译字段
  const getEditableFields = () => {
    switch (moduleKey) {
      case "survey":
        return [
          { key: "title", label: "标题", placeholder: "We want to hear from you" },
          { key: "question", label: "问题", placeholder: "How did you hear about us?" },
        ];
      case "helpdesk":
        return [
          { key: "title", label: "标题", placeholder: "Order Help & Support" },
          { key: "description", label: "描述", placeholder: "Need help with your order?" },
        ];
      case "reorder":
        return [
          { key: "title", label: "标题", placeholder: "Order Again" },
          { key: "subtitle", label: "副标题", placeholder: "Loved your purchase? Get it again!" },
          { key: "buttonText", label: "按钮文字", placeholder: "Reorder Now" },
        ];
      case "order_tracking":
        return [
          { key: "title", label: "标题", placeholder: "Track Your Order" },
        ];
      case "upsell":
        return [
          { key: "title", label: "标题", placeholder: "You might also like" },
          { key: "subtitle", label: "副标题", placeholder: "Complete your purchase" },
        ];
      default:
        return [];
    }
  };

  return (
    <BlockStack gap="400">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          为不同语言的客户提供本地化内容。选择语言后编辑对应的翻译文本。
        </Text>
      </Banner>

      <Select
        label="选择语言"
        options={COMMON_LOCALES}
        value={selectedLocale}
        onChange={setSelectedLocale}
      />

      <Divider />

      {getEditableFields().map((field) => (
        <TextField
          key={field.key}
          label={`${field.label} (${selectedLocale})`}
          value={(currentLocaleData as Record<string, string>)[field.key] || ""}
          onChange={(value) => handleFieldChange(field.key, value)}
          autoComplete="off"
          placeholder={field.placeholder}
          helpText={`默认值将用于未翻译的语言`}
        />
      ))}

      {Object.keys(localization || {}).length > 0 && (
        <Collapsible
          open={true}
          id="localization-preview"
          transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
        >
          <Box paddingBlockStart="300">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                已配置的语言:
              </Text>
              <InlineStack gap="100">
                {Object.keys(localization || {}).map((locale) => (
                  <Tag key={locale}>{locale}</Tag>
                ))}
              </InlineStack>
            </BlockStack>
          </Box>
        </Collapsible>
      )}
    </BlockStack>
  );
}

export default function UiBlocksPage() {
  const { shop, modules, enabledCount, maxModules, planInfo } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const [selectedTab, setSelectedTab] = useState(0);
  const [editingModule, setEditingModule] = useState<ModuleKey | null>(null);
  const [editingSettings, setEditingSettings] = useState<Record<string, unknown> | null>(null);
  const [editingLocalization, setEditingLocalization] = useState<LocalizationSettings | undefined>(undefined);
  const [modalTab, setModalTab] = useState(0); // 0: 设置, 1: 本地化

  const isSubmitting = navigation.state === "submitting";

  const handleToggleModule = useCallback(
    (moduleKey: ModuleKey, enabled: boolean) => {
      const formData = new FormData();
      formData.append("_action", "toggle_module");
      formData.append("moduleKey", moduleKey);
      formData.append("isEnabled", String(enabled));
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleEditModule = useCallback((moduleKey: ModuleKey) => {
    const module = modules.find((m) => m.moduleKey === moduleKey);
    if (module) {
      setEditingModule(moduleKey);
      setEditingSettings(module.settings as Record<string, unknown>);
      setEditingLocalization(module.localization);
      setModalTab(0); // 重置到设置标签
    }
  }, [modules]);

  const handleSaveSettings = useCallback(() => {
    if (!editingModule || !editingSettings) return;

    const formData = new FormData();
    formData.append("_action", "update_settings");
    formData.append("moduleKey", editingModule);
    formData.append("settings", JSON.stringify(editingSettings));
    // 同时保存本地化设置
    if (editingLocalization) {
      formData.append("localization", JSON.stringify(editingLocalization));
    }
    submit(formData, { method: "post" });
    setEditingModule(null);
    setEditingSettings(null);
    setEditingLocalization(undefined);
  }, [editingModule, editingSettings, editingLocalization, submit]);

  const handleResetModule = useCallback(() => {
    if (!editingModule) return;

    const formData = new FormData();
    formData.append("_action", "reset_module");
    formData.append("moduleKey", editingModule);
    submit(formData, { method: "post" });
    setEditingModule(null);
    setEditingSettings(null);
  }, [editingModule, submit]);

  const canEnableMore = maxModules === -1 || enabledCount < maxModules;

  const tabs = [
    { id: "all", content: "全部模块" },
    { id: "engagement", content: "用户互动" },
    { id: "support", content: "客户支持" },
    { id: "conversion", content: "转化提升" },
  ];

  const filterModules = (category?: string) => {
    if (!category || category === "all") return modules;
    return modules.filter((m) => UI_MODULES[m.moduleKey].category === category);
  };

  const filteredModules = filterModules(
    selectedTab === 0 ? undefined : tabs[selectedTab].id
  );

  if (!shop) {
    return (
      <Page title="UI 模块配置">
        <Banner tone="critical">
          <Text as="p">未找到店铺信息，请重新安装应用。</Text>
        </Banner>
      </Page>
    );
  }

  const getRequiredPlan = (moduleKey: ModuleKey): PlanId | undefined => {
    const info = UI_MODULES[moduleKey];
    const planOrder: PlanId[] = ["free", "starter", "growth", "agency"];
    const currentIndex = planOrder.indexOf(shop.plan);
    const requiredIndex = planOrder.indexOf(info.requiredPlan);
    if (currentIndex < requiredIndex) {
      return info.requiredPlan;
    }
    return undefined;
  };

  return (
    <Page
      title="UI 模块配置"
      subtitle="配置 Thank You / Order Status 页面的 UI 模块"
      primaryAction={{
        content: "刷新",
        onAction: () => revalidator.revalidate(),
        icon: RefreshIcon,
      }}
    >
      <BlockStack gap="500">
        {/* 套餐信息卡片 */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <InlineStack gap="200">
                <Text as="h2" variant="headingMd">
                  UI 模块配额
                </Text>
                <Badge tone={canEnableMore ? "success" : "warning"}>
                  {planInfo.name}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {maxModules === -1
                  ? "无限模块"
                  : `已启用 ${enabledCount} / ${maxModules} 个模块`}
              </Text>
            </BlockStack>
            {maxModules !== -1 && !canEnableMore && (
              <Button url="/app/billing" variant="primary">
                升级解锁更多
              </Button>
            )}
          </InlineStack>
        </Card>

        {/* 提示信息 */}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              配置完成后，模块将自动显示在 Thank You 和 Order Status 页面。
              您可以在 Shopify Admin 的 <strong>Checkout Editor</strong> 中调整模块位置和样式。
            </Text>
            <Button
              url="https://admin.shopify.com/store/settings/checkout/editor"
              variant="plain"
              size="slim"
              external
            >
              打开 Checkout Editor
            </Button>
          </BlockStack>
        </Banner>

        {/* 模块列表 */}
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <Box paddingBlockStart="400">
            <BlockStack gap="400">
              {filteredModules.length === 0 ? (
                <Card>
                  <EmptyState
                    heading="暂无模块"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <Text as="p">此分类下暂无可用模块。</Text>
                  </EmptyState>
                </Card>
              ) : (
                filteredModules.map((module) => (
                  <ModuleCard
                    key={module.moduleKey}
                    module={module}
                    onToggle={handleToggleModule}
                    onEdit={handleEditModule}
                    isSubmitting={isSubmitting}
                    canEnable={canEnableMore}
                    upgradeRequired={getRequiredPlan(module.moduleKey)}
                  />
                ))
              )}
            </BlockStack>
          </Box>
        </Tabs>

        {/* 快速链接 */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              🔗 相关页面
            </Text>
            <InlineStack gap="300" wrap>
              <Button url="/app/settings">平台设置</Button>
              <Button url="/app/scan">扫描报告</Button>
              <Button url="/app/migrate">像素迁移</Button>
              <Button url="/app/verification">验收向导</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* 编辑模块设置模态框 */}
      <Modal
        open={editingModule !== null}
        onClose={() => {
          setEditingModule(null);
          setEditingSettings(null);
          setEditingLocalization(undefined);
        }}
        title={`配置 ${editingModule ? UI_MODULES[editingModule].name : ""}`}
        primaryAction={{
          content: "保存",
          onAction: handleSaveSettings,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "重置为默认",
            onAction: handleResetModule,
            destructive: true,
          },
          {
            content: "取消",
            onAction: () => {
              setEditingModule(null);
              setEditingSettings(null);
              setEditingLocalization(undefined);
            },
          },
        ]}
        size="large"
      >
        <Modal.Section>
          {/* 模态框内标签页切换 */}
          <Tabs
            tabs={[
              { id: "settings", content: "基础设置" },
              { id: "localization", content: "🌐 多语言" },
            ]}
            selected={modalTab}
            onSelect={setModalTab}
          >
            <Box paddingBlockStart="400">
              {/* 基础设置标签页 */}
              {modalTab === 0 && (
                <>
                  {editingModule === "survey" && editingSettings && (
                    <SurveySettingsForm
                      settings={editingSettings as SurveySettings}
                      onChange={(s) => setEditingSettings(s)}
                    />
                  )}
                  {editingModule === "helpdesk" && editingSettings && (
                    <HelpdeskSettingsForm
                      settings={editingSettings as HelpdeskSettings}
                      onChange={(s) => setEditingSettings(s)}
                    />
                  )}
                  {editingModule === "reorder" && editingSettings && (
                    <ReorderSettingsForm
                      settings={editingSettings as ReorderSettings}
                      onChange={(s) => setEditingSettings(s)}
                    />
                  )}
                  {editingModule === "order_tracking" && editingSettings && (
                    <OrderTrackingSettingsForm
                      settings={editingSettings as OrderTrackingSettings}
                      onChange={(s) => setEditingSettings(s)}
                    />
                  )}
                  {editingModule === "upsell" && editingSettings && (
                    <UpsellSettingsForm
                      settings={editingSettings as UpsellSettings}
                      onChange={(s) => setEditingSettings(s)}
                    />
                  )}
                </>
              )}

              {/* 本地化设置标签页 */}
              {modalTab === 1 && editingModule && (
                <LocalizationSettingsForm
                  localization={editingLocalization}
                  onChange={setEditingLocalization}
                  moduleKey={editingModule}
                />
              )}
            </Box>
          </Tabs>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

