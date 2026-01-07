

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
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
  List,
  Collapsible,
  Tag,
  FormLayout,
  InlineError,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  EditIcon,
  SettingsIcon,
  RefreshIcon,
  ExternalIcon,
} from "~/components/icons";
import { EnhancedEmptyState, useToastContext } from "~/components/ui";
import { DisplayRulesEditor } from "~/components/ui-blocks/DisplayRulesEditor";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getUiModuleConfigs,
  updateUiModuleConfig,
  resetModuleToDefault,
  getEnabledModulesCount,
  batchToggleModules,
} from "../services/ui-extension.server";
import { generateModulePreviewUrl, isDevStore } from "../utils/dev-store.server";
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
  type DisplayRules,
} from "../types/ui-extension";
import { getPlanOrDefault, type PlanId, BILLING_PLANS } from "../services/billing/plans";

interface LoaderData {
  shop: {
    id: string;
    plan: PlanId;
  } | null;
  shopDomain: string;
  modules: UiModuleConfig[];
  enabledCount: number;
  maxModules: number;
  planInfo: typeof BILLING_PLANS[PlanId];
  isDevStore: boolean;
  modulePreviewUrls: Record<string, { thank_you?: string; order_status?: string }>;
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
      shopDomain,
      modules: [],
      enabledCount: 0,
      maxModules: 0,
      planInfo: BILLING_PLANS.free,
      isDevStore: false,
      modulePreviewUrls: {},
    });
  }

  const planId = shop.plan as PlanId;
  const planInfo = getPlanOrDefault(planId);
  const modules = await getUiModuleConfigs(shop.id);
  const enabledCount = await getEnabledModulesCount(shop.id);

  const isDev = isDevStore(shopDomain);
  const modulePreviewUrls: Record<string, { thank_you?: string; order_status?: string }> = {};

  if (isDev) {
    for (const module of modules) {
      const urls: { thank_you?: string; order_status?: string } = {};
      if (UI_MODULES[module.moduleKey].targets.includes("thank_you")) {
        urls.thank_you = generateModulePreviewUrl(shopDomain, module.moduleKey, "thank_you") || undefined;
      }
      if (UI_MODULES[module.moduleKey].targets.includes("order_status")) {
        urls.order_status = generateModulePreviewUrl(shopDomain, module.moduleKey, "order_status") || undefined;
      }
      modulePreviewUrls[module.moduleKey] = urls;
    }
  }

  return json<LoaderData>({
    shop: { id: shop.id, plan: planId },
    shopDomain,
    modules,
    enabledCount,
    maxModules: planInfo.uiModules,
    planInfo,
    isDevStore: isDev,
    modulePreviewUrls,
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

    case "batch_toggle_modules": {
      const updatesJson = formData.get("updates") as string;
      try {
        const updates = JSON.parse(updatesJson) as Array<{ moduleKey: ModuleKey; isEnabled: boolean }>;
        const result = await batchToggleModules(shop.id, updates);
        if (!result.success) {
          return json({ error: "批量操作失败" }, { status: 400 });
        }
        return json({
          success: true,
          actionType: "batch_toggle_modules",
          results: result.results
        });
      } catch {
        return json({ error: "无效的批量操作数据" }, { status: 400 });
      }
    }

    default:
      return json({ error: "未知操作" }, { status: 400 });
  }
};

function ModuleCard({
  module,
  onToggle,
  onEdit,
  isSubmitting,
  canEnable,
  upgradeRequired,
  isSelected,
  onSelect,
}: {
  module: UiModuleConfig;
  onToggle: (moduleKey: ModuleKey, enabled: boolean) => void;
  onEdit: (moduleKey: ModuleKey) => void;
  isSubmitting: boolean;
  canEnable: boolean;
  upgradeRequired?: PlanId;
  isSelected?: boolean;
  onSelect?: (moduleKey: ModuleKey, selected: boolean) => void;
}) {
  const info = UI_MODULES[module.moduleKey];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            {onSelect && (
              <Checkbox
                checked={isSelected || false}
                onChange={(checked) => onSelect(module.moduleKey, checked)}
                label=""
              />
            )}
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
                {}
                {(module.moduleKey === "survey" || module.moduleKey === "helpdesk") && (
                  <Badge tone="success" size="small">v1 支持</Badge>
                )}
                {module.moduleKey !== "survey" && module.moduleKey !== "helpdesk" && !info.disabled && (
                  <Badge tone="info" size="small">v1.1+</Badge>
                )}
                {info.disabled && (
                  <Badge tone="info" size="small">v1.1+ 规划中</Badge>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {info.description}
                {info.disabled && info.disabledReason && `（${info.disabledReason}）`}
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
              disabled={(!canEnable && !module.isEnabled) || info.disabled}
              size="slim"
            >
              {module.isEnabled ? "停用" : info.disabled ? "v1.1+ 支持" : "启用"}
            </Button>
          </InlineStack>
        </InlineStack>

        {}
        <InlineStack gap="100">
          {info.targets.map((target) => (
            <Tag key={target}>
              {target === "thank_you" ? "Thank You 页" : "订单状态页"}
            </Tag>
          ))}
          <Tag>{getCategoryLabel(info.category)}</Tag>
        </InlineStack>

        {}
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

function SurveySettingsForm({
  settings,
  onChange,
}: {
  settings: SurveySettings;
  onChange: (settings: SurveySettings) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (field: string, value: string) => {
    const newErrors = { ...errors };
    if (field === "title" && !value.trim()) {
      newErrors.title = "标题不能为空";
    } else if (field === "question" && !value.trim()) {
      newErrors.question = "问题不能为空";
    } else {
      delete newErrors[field];
    }
    setErrors(newErrors);
  };

  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="标题"
            value={settings.title || ""}
            onChange={(value) => {
              onChange({ ...settings, title: value });
              validateField("title", value);
            }}
            onBlur={() => validateField("title", settings.title || "")}
            error={errors.title}
            autoComplete="off"
            helpText="显示在问卷顶部的标题文字"
            placeholder="我们想听听您的意见"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="问题"
            value={settings.question || ""}
            onChange={(value) => {
              onChange({ ...settings, question: value });
              validateField("question", value);
            }}
            onBlur={() => validateField("question", settings.question || "")}
            error={errors.question}
            autoComplete="off"
            helpText="例如：您是如何了解到我们的？"
            placeholder="您是如何了解到我们的？"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <Checkbox
            label="显示评分选项"
            checked={settings.showRating !== false}
            onChange={(checked) => onChange({ ...settings, showRating: checked })}
            helpText="允许客户对购物体验进行评分（1-5 星）"
          />
        </FormLayout.Group>

        {settings.showRating !== false && (
          <FormLayout.Group>
            <TextField
              label="评分标签"
              value={settings.ratingLabel || ""}
              onChange={(value) => onChange({ ...settings, ratingLabel: value })}
              autoComplete="off"
              helpText="评分选项的提示文字"
              placeholder="请为本次购物体验打分"
            />
          </FormLayout.Group>
        )}

        <Divider />

        <FormLayout.Group>
          <BlockStack gap="200">
            <Text as="h4" variant="headingSm">
              选项配置
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              来源选项（用逗号分隔多个选项）
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
              helpText="示例：搜索引擎, 社交媒体, 朋友推荐, 广告, 其他"
              placeholder="搜索引擎, 社交媒体, 朋友推荐"
            />
          </BlockStack>
        </FormLayout.Group>
      </FormLayout>
    </BlockStack>
  );
}

function HelpdeskSettingsForm({
  settings,
  onChange,
}: {
  settings: HelpdeskSettings;
  onChange: (settings: HelpdeskSettings) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateEmail = (email: string | undefined) => {
    if (!email) return undefined;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) ? undefined : "请输入有效的邮箱地址";
  };

  const validateUrl = (url: string | undefined) => {
    if (!url) return undefined;
    if (!url.startsWith("/") && !url.startsWith("http")) {
      return "链接应以 / 开头（相对路径）或 http/https 开头（绝对路径）";
    }
    return undefined;
  };

  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="标题"
            value={settings.title || ""}
            onChange={(value) => onChange({ ...settings, title: value })}
            autoComplete="off"
            helpText="帮助中心的标题"
            placeholder="订单帮助与售后"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="描述"
            value={settings.description || ""}
            onChange={(value) => onChange({ ...settings, description: value })}
            autoComplete="off"
            multiline={2}
            helpText="帮助中心的描述文字"
            placeholder="如需修改收件信息、查看售后政策或联系人工客服，请使用下方入口。"
          />
        </FormLayout.Group>

        <Divider />

        <FormLayout.Group>
          <Text as="h4" variant="headingSm">
            链接配置
          </Text>
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="FAQ 链接"
            value={settings.faqUrl ?? ""}
            onChange={(value) => {
              onChange({ ...settings, faqUrl: value || undefined });
              const error = validateUrl(value);
              setErrors({ ...errors, faqUrl: error || "" });
            }}
            onBlur={() => {
              const error = validateUrl(settings.faqUrl ?? "");
              setErrors({ ...errors, faqUrl: error || "" });
            }}
            error={errors.faqUrl || undefined}
            autoComplete="off"
            placeholder="/pages/faq"
            helpText="常见问题页面链接（相对路径或绝对路径）"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="联系邮箱"
            type="email"
            value={settings.contactEmail ?? ""}
            onChange={(value) => {
              onChange({ ...settings, contactEmail: value || undefined });
              const error = validateEmail(value);
              setErrors({ ...errors, contactEmail: error || "" });
            }}
            onBlur={() => {
              const error = validateEmail(settings.contactEmail ?? "");
              setErrors({ ...errors, contactEmail: error || "" });
            }}
            error={errors.contactEmail || undefined}
            autoComplete="off"
            placeholder="support@example.com"
            helpText="客服邮箱地址"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="联系页面链接"
            value={settings.contactUrl ?? ""}
            onChange={(value) => {
              onChange({ ...settings, contactUrl: value || undefined });
              const error = validateUrl(value);
              setErrors({ ...errors, contactUrl: error || "" });
            }}
            onBlur={() => {
              const error = validateUrl(settings.contactUrl ?? "");
              setErrors({ ...errors, contactUrl: error || "" });
            }}
            error={errors.contactUrl || undefined}
            autoComplete="off"
            placeholder="/pages/contact"
            helpText="联系页面链接"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="WhatsApp 号码"
            value={settings.whatsappNumber || ""}
            onChange={(value) => onChange({ ...settings, whatsappNumber: value })}
            autoComplete="off"
            placeholder="+8613800138000"
            helpText="WhatsApp 联系号码（包含国家代码）"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="Facebook Messenger 链接"
            value={settings.messengerUrl ?? ""}
            onChange={(value) => {
              onChange({ ...settings, messengerUrl: value || undefined });
              const error = validateUrl(value);
              setErrors({ ...errors, messengerUrl: error || "" });
            }}
            onBlur={() => {
              const error = validateUrl(settings.messengerUrl ?? "");
              setErrors({ ...errors, messengerUrl: error || "" });
            }}
            error={errors.messengerUrl || undefined}
            autoComplete="off"
            placeholder="https://m.me/your-page"
            helpText="Facebook Messenger 联系链接（可选）"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="继续购物链接"
            value={settings.continueShoppingUrl ?? ""}
            onChange={(value) => {
              onChange({ ...settings, continueShoppingUrl: value || undefined });
              const error = validateUrl(value);
              setErrors({ ...errors, continueShoppingUrl: error || "" });
            }}
            onBlur={() => {
              const error = validateUrl(settings.continueShoppingUrl ?? "");
              setErrors({ ...errors, continueShoppingUrl: error || "" });
            }}
            error={errors.continueShoppingUrl || undefined}
            autoComplete="off"
            placeholder="/"
            helpText="继续购物按钮的链接地址"
          />
        </FormLayout.Group>
      </FormLayout>
    </BlockStack>
  );
}

function ReorderSettingsForm({
  settings,
  onChange,
}: {
  settings: ReorderSettings;
  onChange: (settings: ReorderSettings) => void;
}) {
  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="标题"
            value={settings.title || ""}
            onChange={(value) => onChange({ ...settings, title: value })}
            autoComplete="off"
            helpText="再购模块的主标题"
            placeholder="📦 再次购买"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="副标题"
            value={settings.subtitle || ""}
            onChange={(value) => onChange({ ...settings, subtitle: value })}
            autoComplete="off"
            helpText="副标题或描述文字"
            placeholder="喜欢这次购物？一键再次订购相同商品"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="按钮文字"
            value={settings.buttonText || ""}
            onChange={(value) => onChange({ ...settings, buttonText: value })}
            autoComplete="off"
            helpText="再购按钮上显示的文字"
            placeholder="再次购买 →"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <Checkbox
            label="显示商品列表"
            checked={settings.showItems !== false}
            onChange={(checked) => onChange({ ...settings, showItems: checked })}
            helpText="是否在再购模块中显示商品列表"
          />
        </FormLayout.Group>

        {settings.showItems !== false && (
          <FormLayout.Group>
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
              helpText="当订单包含多个商品时，最多显示的商品数量"
            />
          </FormLayout.Group>
        )}
      </FormLayout>
    </BlockStack>
  );
}

function OrderTrackingSettingsForm({
  settings,
  onChange,
}: {
  settings: OrderTrackingSettings;
  onChange: (settings: OrderTrackingSettings) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="标题"
            value={settings.title || ""}
            onChange={(value) => onChange({ ...settings, title: value })}
            autoComplete="off"
            helpText="物流追踪模块的标题"
            placeholder="物流追踪"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <Select
            label="物流追踪服务商"
            options={[
              { label: "Shopify 原生", value: "native" },

            ]}
            value={settings.provider || "native"}
            onChange={(value) => {

              if (value === "native") {
                onChange({ ...settings, provider: value as "native" });
              }
            }}
            helpText="v1.0 版本仅支持 Shopify 原生物流追踪。第三方服务商（AfterShip/17Track）将在 v2.0+ 版本中提供"
          />
        </FormLayout.Group>

        {settings.provider && settings.provider !== "native" && (
          <FormLayout.Group>
            <TextField
              label="API Key"
              type="password"
              value={settings.apiKey || ""}
              onChange={(value) => {
                onChange({ ...settings, apiKey: value });
                if (!value.trim() && settings.provider !== "native") {
                  setErrors({ ...errors, apiKey: "API Key 不能为空" });
                } else {
                  delete errors.apiKey;
                  setErrors({ ...errors });
                }
              }}
              onBlur={() => {
                if (!settings.apiKey?.trim() && settings.provider !== "native") {
                  setErrors({ ...errors, apiKey: "API Key 不能为空" });
                } else {
                  delete errors.apiKey;
                  setErrors({ ...errors });
                }
              }}
              error={errors.apiKey}
              autoComplete="off"
              helpText={`输入 ${settings.provider === "aftership" ? "AfterShip" : "17Track"} 服务商提供的 API Key`}
              placeholder="输入 API Key"
            />
          </FormLayout.Group>
        )}

        <FormLayout.Group>
          <Checkbox
            label="显示预计送达时间"
            checked={settings.showEstimatedDelivery !== false}
            onChange={(checked) => onChange({ ...settings, showEstimatedDelivery: checked })}
            helpText="是否在物流追踪中显示预计送达时间"
          />
        </FormLayout.Group>
      </FormLayout>
    </BlockStack>
  );
}

function UpsellSettingsForm({
  settings,
  onChange,
}: {
  settings: UpsellSettings;
  onChange: (settings: UpsellSettings) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateDiscountPercent = (value: string) => {
    const num = parseInt(value);
    if (value && (isNaN(num) || num < 0 || num > 100)) {
      return "折扣百分比应在 0-100 之间";
    }
    return undefined;
  };

  return (
    <BlockStack gap="400">
      <FormLayout>
        <FormLayout.Group>
          <TextField
            label="标题"
            value={settings.title || ""}
            onChange={(value) => onChange({ ...settings, title: value })}
            autoComplete="off"
            helpText="追加销售模块的标题"
            placeholder="🎁 为您推荐"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="副标题"
            value={settings.subtitle || ""}
            onChange={(value) => onChange({ ...settings, subtitle: value })}
            autoComplete="off"
            helpText="副标题或描述文字"
            placeholder="您可能还喜欢这些商品"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="折扣码"
            value={settings.discountCode || ""}
            onChange={(value) => onChange({ ...settings, discountCode: value })}
            autoComplete="off"
            helpText="可选：为推荐商品提供专属折扣码（需要在 Shopify 中创建该折扣码）"
            placeholder="SUMMER10"
          />
        </FormLayout.Group>

        <FormLayout.Group>
          <TextField
            label="折扣百分比"
            type="number"
            value={String(settings.discountPercent || "")}
            onChange={(value) => {
              onChange({ ...settings, discountPercent: parseInt(value) || undefined });
              const error = validateDiscountPercent(value);
              setErrors({ ...errors, discountPercent: error || "" });
            }}
            onBlur={() => {
              const error = validateDiscountPercent(String(settings.discountPercent || ""));
              setErrors({ ...errors, discountPercent: error || "" });
            }}
            error={errors.discountPercent}
            autoComplete="off"
            suffix="%"
            helpText="折扣百分比（0-100），例如：10 表示 10% 折扣"
            placeholder="10"
          />
        </FormLayout.Group>
      </FormLayout>

      <Banner tone="info">
        <Text as="p" variant="bodySm">
          <strong>产品配置说明</strong>：推荐的商品需要在 Shopify Admin 的 Checkout Editor 中设置。
          此处仅控制展示样式和折扣信息。
        </Text>
      </Banner>
    </BlockStack>
  );
}

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
  const { shop, shopDomain, modules, enabledCount, maxModules, planInfo, isDevStore, modulePreviewUrls } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { showSuccess, showError } = useToastContext();

  const [selectedTab, setSelectedTab] = useState(0);
  const [editingModule, setEditingModule] = useState<ModuleKey | null>(null);
  const [editingSettings, setEditingSettings] = useState<Record<string, unknown> | null>(null);
  const [editingLocalization, setEditingLocalization] = useState<LocalizationSettings | undefined>(undefined);
  const [editingDisplayRules, setEditingDisplayRules] = useState<DisplayRules | null>(null);
  const [modalTab, setModalTab] = useState(0);
  const [selectedModules, setSelectedModules] = useState<Set<ModuleKey>>(new Set());

  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData) {
      const data = actionData as { success?: boolean; error?: string; actionType?: string };
      if (data.success) {
        showSuccess("操作成功");
        if (data.actionType === "update_settings" || data.actionType === "toggle_module") {
          revalidator.revalidate();
        }
      } else if (data.error) {
        showError(data.error);
      }
    }
  }, [actionData, showSuccess, showError, revalidator]);

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
      setEditingDisplayRules(module.displayRules);
      setModalTab(0);
    }
  }, [modules]);

  const handleBatchEnable = useCallback(() => {
    if (selectedModules.size === 0) return;
    const updates = Array.from(selectedModules).map((moduleKey) => ({
      moduleKey,
      isEnabled: true,
    }));
    const formData = new FormData();
    formData.append("_action", "batch_toggle_modules");
    formData.append("updates", JSON.stringify(updates));
    submit(formData, { method: "post" });
    setSelectedModules(new Set());
  }, [selectedModules, submit]);

  const handleBatchDisable = useCallback(() => {
    if (selectedModules.size === 0) return;
    const updates = Array.from(selectedModules).map((moduleKey) => ({
      moduleKey,
      isEnabled: false,
    }));
    const formData = new FormData();
    formData.append("_action", "batch_toggle_modules");
    formData.append("updates", JSON.stringify(updates));
    submit(formData, { method: "post" });
    setSelectedModules(new Set());
  }, [selectedModules, submit]);

  const handleSaveSettings = useCallback(() => {
    if (!editingModule || !editingSettings) return;

    const formData = new FormData();
    formData.append("_action", "update_settings");
    formData.append("moduleKey", editingModule);
    formData.append("settings", JSON.stringify(editingSettings));

    if (editingLocalization) {
      formData.append("localization", JSON.stringify(editingLocalization));
    }
    submit(formData, { method: "post" });
    setEditingModule(null);
    setEditingSettings(null);
    setEditingLocalization(undefined);
    setEditingDisplayRules(null);
  }, [editingModule, editingSettings, editingLocalization, submit]);

  const handleSaveDisplayRules = useCallback(() => {
    if (!editingModule || !editingDisplayRules) return;

    const formData = new FormData();
    formData.append("_action", "update_display_rules");
    formData.append("moduleKey", editingModule);
    formData.append("displayRules", JSON.stringify(editingDisplayRules));
    submit(formData, { method: "post" });
  }, [editingModule, editingDisplayRules, submit]);

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

    const availableModules = modules.filter((m) => !UI_MODULES[m.moduleKey].disabled);
    if (!category || category === "all") return availableModules;
    return availableModules.filter((m) => UI_MODULES[m.moduleKey].category === category);
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
      title="Thank you / Order status 模块"
      subtitle="v1 仅支持：Survey 问卷 + Helpdesk 帮助中心（二选一）• 基于 Checkout UI Extensions，符合 Shopify 官方推荐 • Survey 是官方教程背书的场景 • Migration $49/月"
      primaryAction={{
        content: "刷新",
        onAction: () => revalidator.revalidate(),
        icon: RefreshIcon,
      }}
    >
      <BlockStack gap="500">
        {}
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

        {}
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              v1.0 支持范围说明：
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v1.0 已支持</strong>：购后问卷（Survey）、帮助中心（Helpdesk）、物流追踪（Shopify 原生）、再购按钮（Reorder）
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v1.1+ 规划</strong>：追加销售（Upsell）模块将在 v1.1+ 版本中提供
            </Text>
            <Text as="p" variant="bodySm">
              • <strong>v2.0+ 规划</strong>：第三方物流集成（AfterShip/17Track）将在 v2.0+ 版本中提供
            </Text>
            <Divider />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              付费触发点（3个强CTA，直接对应商家的"升级项目交付"）：
            </Text>
            <List type="number">
              <List.Item><strong>启用像素迁移（Test 环境）</strong> → 进入付费试用/订阅（Starter $29/月）</List.Item>
              <List.Item><strong>发布 Thank you/Order status 模块</strong> → 进入付费（Starter $29/月）</List.Item>
              <List.Item><strong>生成验收报告（PDF/CSV）</strong> → 付费（Growth $79/月 或 Agency $199/月）</List.Item>
            </List>
            <Divider />
            <Text as="p" variant="bodySm">
              配置完成后，模块将自动显示在 Thank You 和 Order Status 页面。
              您可以在 Shopify Admin 的 <strong>Checkout Editor</strong> 中调整模块位置和样式。
            </Text>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                Target 说明：
              </Text>
              <List type="bullet">
                <List.Item>
                  <Text as="span" variant="bodySm">
                    <strong>Thank you block：</strong>使用 <code>purchase.thank-you.block.render</code> target
                  </Text>
                </List.Item>
                <List.Item>
                  <Text as="span" variant="bodySm">
                    <strong>Order status block：</strong>使用 <code>customer-account.order-status.block.render</code> target
                  </Text>
                </List.Item>
              </List>
            </BlockStack>
            <Button
              url="https://help.shopify.com/en/manual/pixels/customer-events"
              variant="plain"
              size="slim"
              external
            >
              打开 Checkout Editor
            </Button>
          </BlockStack>
        </Banner>

        {}
        {selectedModules.size > 0 && (
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodyMd">
                已选择 {selectedModules.size} 个模块
              </Text>
              <InlineStack gap="200">
                <Button
                  size="slim"
                  onClick={handleBatchEnable}
                  loading={isSubmitting}
                  disabled={!canEnableMore}
                >
                  批量启用
                </Button>
                <Button
                  size="slim"
                  variant="secondary"
                  onClick={handleBatchDisable}
                  loading={isSubmitting}
                >
                  批量停用
                </Button>
                <Button
                  size="slim"
                  variant="plain"
                  onClick={() => setSelectedModules(new Set())}
                >
                  取消选择
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        )}
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <Box paddingBlockStart="400">
            <BlockStack gap="400">
              {filteredModules.length === 0 ? (
                <EnhancedEmptyState
                  icon="📦"
                  title="暂无模块"
                  description="此分类下暂无可用模块。"
                  helpText="请选择其他分类查看模块，或等待新模块上线。"
                />
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
                    isSelected={selectedModules.has(module.moduleKey)}
                    onSelect={(moduleKey, selected) => {
                      const newSelected = new Set(selectedModules);
                      if (selected) {
                        newSelected.add(moduleKey);
                      } else {
                        newSelected.delete(moduleKey);
                      }
                      setSelectedModules(newSelected);
                    }}
                  />
                ))
              )}
            </BlockStack>
          </Box>
        </Tabs>

        {}
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

      {}
      <Modal
        open={editingModule !== null}
            onClose={() => {
          setEditingModule(null);
          setEditingSettings(null);
          setEditingLocalization(undefined);
          setEditingDisplayRules(null);
        }}
        title={`配置 ${editingModule ? UI_MODULES[editingModule].name : ""}`}
        primaryAction={{
          content: "保存",
          onAction: () => {
            if (modalTab === 1 && editingDisplayRules) {
              handleSaveDisplayRules();
            } else {
              handleSaveSettings();
            }
          },
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
              setEditingDisplayRules(null);
            },
          },
        ]}
        size="large"
      >
        <Modal.Section>
          {}
          {editingModule && isDevStore && modulePreviewUrls[editingModule] && (
            <Box paddingBlockEnd="400">
              <Banner tone="info">
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    <strong>开发商店预览</strong>：您可以在以下页面预览此模块的效果
                  </Text>
                  <InlineStack gap="200" wrap>
                    {modulePreviewUrls[editingModule].thank_you && (
                      <Button
                        url={modulePreviewUrls[editingModule].thank_you}
                        external
                        icon={ExternalIcon}
                        size="slim"
                      >
                        预览 Thank You 页
                      </Button>
                    )}
                    {modulePreviewUrls[editingModule].order_status && (
                      <Button
                        url={modulePreviewUrls[editingModule].order_status}
                        external
                        icon={ExternalIcon}
                        size="slim"
                      >
                        预览订单状态页
                      </Button>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    💡 提示：Thank You 页面需要通过测试结账流程查看；订单状态页需要先创建测试订单。
                  </Text>
                </BlockStack>
              </Banner>
            </Box>
          )}
          <Tabs
            tabs={[
              { id: "settings", content: "基础设置" },
              { id: "display_rules", content: "显示规则" },
              { id: "localization", content: "🌐 多语言" },
            ]}
            selected={modalTab}
            onSelect={setModalTab}
          >
            <Box paddingBlockStart="400">
              {}
              {modalTab === 0 && (
                <>
                  {editingModule === "survey" && editingSettings && (
                    <SurveySettingsForm
                      settings={editingSettings as SurveySettings}
                      onChange={(s) => setEditingSettings(s as Record<string, unknown>)}
                    />
                  )}
                  {editingModule === "helpdesk" && editingSettings && (
                    <HelpdeskSettingsForm
                      settings={editingSettings as HelpdeskSettings}
                      onChange={(s) => setEditingSettings(s as Record<string, unknown>)}
                    />
                  )}
                  {editingModule === "reorder" && editingSettings && (
                    <ReorderSettingsForm
                      settings={editingSettings as ReorderSettings}
                      onChange={(s) => setEditingSettings(s as Record<string, unknown>)}
                    />
                  )}
                  {editingModule === "order_tracking" && editingSettings && (
                    <OrderTrackingSettingsForm
                      settings={editingSettings as OrderTrackingSettings}
                      onChange={(s) => setEditingSettings(s as Record<string, unknown>)}
                    />
                  )}
                  {}
                  {editingModule === "upsell" && editingSettings && UI_MODULES.upsell.disabled && (
                    <Banner tone="warning">
                      <Text as="p">
                        Upsell 模块在 v1.0 版本中不可用，将在 v1.1+ 版本中提供。
                      </Text>
                    </Banner>
                  )}
                </>
              )}

              {}
              {modalTab === 1 && editingModule && editingDisplayRules && (
                <DisplayRulesEditor
                  displayRules={editingDisplayRules}
                  onChange={setEditingDisplayRules}
                  moduleKey={editingModule}
                />
              )}

              {modalTab === 2 && editingModule && (
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

