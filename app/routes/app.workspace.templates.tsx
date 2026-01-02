

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useRevalidator, useActionData } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import { useToastContext, EnhancedEmptyState } from "~/components/ui";
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
  DataTable,
  Modal,
  TextField,
  Select,
  Checkbox,
  List,
} from "@shopify/polaris";
import {
  PlusIcon,
  DeleteIcon,
  EditIcon,
  CheckCircleIcon,
} from "~/components/icons";
import { BatchApplyProgress } from "~/components/workspace/BatchApplyProgress";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createPixelTemplate,
  getPixelTemplates,
  updatePixelTemplate,
  deletePixelTemplate,
  batchApplyPixelTemplate,
  PRESET_TEMPLATES,
  applyPresetTemplate,
  type PixelTemplateConfig,
} from "../services/batch-pixel-apply.server";
import { getShopGroups, getShopGroupDetails } from "../services/multi-shop.server";

interface TemplateData {
  id: string;
  name: string;
  description: string | null;
  platforms: PixelTemplateConfig[];
  isPublic: boolean;
  usageCount: number;
  createdAt: Date;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, plan: true },
  });

  if (!shop) {
    return json({
      shop: null,
      templates: [],
      presets: PRESET_TEMPLATES,
      groups: [],
    });
  }

  const templates = await getPixelTemplates(shop.id);
  const groups = await getShopGroups(shop.id);

  return json({
    shop: { id: shop.id, shopDomain: shop.shopDomain, plan: shop.plan },
    templates,
    presets: PRESET_TEMPLATES,
    groups,
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
    case "create_template": {
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const platformsJson = formData.get("platforms") as string;

      if (!name) {
        return json({ error: "请输入模板名称" }, { status: 400 });
      }

      let platforms: PixelTemplateConfig[];
      try {
        platforms = JSON.parse(platformsJson || "[]");
      } catch {
        return json({ error: "平台配置格式错误" }, { status: 400 });
      }

      const result = await createPixelTemplate({
        ownerId: shop.id,
        name,
        description,
        platforms,
      });

      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({ success: true, templateId: result.templateId });
    }

    case "update_template": {
      const templateId = formData.get("templateId") as string;
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const platformsJson = formData.get("platforms") as string;

      let platforms: PixelTemplateConfig[] | undefined;
      if (platformsJson) {
        try {
          platforms = JSON.parse(platformsJson);
        } catch {
          return json({ error: "平台配置格式错误" }, { status: 400 });
        }
      }

      const result = await updatePixelTemplate(templateId, shop.id, {
        name,
        description,
        platforms,
      });

      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({ success: true });
    }

    case "delete_template": {
      const templateId = formData.get("templateId") as string;
      const result = await deletePixelTemplate(templateId, shop.id);

      if (!result.success) {
        return json({ error: result.error }, { status: 400 });
      }

      return json({ success: true });
    }

    case "apply_template": {
      const templateId = formData.get("templateId") as string;
      const groupId = formData.get("groupId") as string;
      const overwrite = formData.get("overwrite") === "true";

      if (!templateId) {
        return json({ error: "请选择模板" }, { status: 400 });
      }

      let targetShopIds: string[];
      if (groupId) {
        const group = await getShopGroupDetails(groupId, shop.id);
        if (!group) {
          return json({ error: "分组不存在" }, { status: 404 });
        }
        targetShopIds = group.members.map((m) => m.shopId);
      } else {

        targetShopIds = [shop.id];
      }

      const result = await batchApplyPixelTemplate({
        templateId,
        targetShopIds,
        overwriteExisting: overwrite,
      });

      return json({
        success: result.success,
        actionType: "apply_template",
        result,
      });
    }

    case "apply_preset": {
      const presetId = formData.get("presetId") as string;
      const overwrite = formData.get("overwrite") === "true";

      const result = await applyPresetTemplate(presetId, shop.id, overwrite);

      return json({
        success: result.success,
        actionType: "apply_preset",
        message: result.message,
        platformsApplied: result.platformsApplied,
      });
    }

    default:
      return json({ error: "未知操作" }, { status: 400 });
  }
};

const PLATFORM_OPTIONS = [
  { label: "Google Analytics 4", value: "google" },
  { label: "Meta (Facebook)", value: "meta" },
  { label: "TikTok", value: "tiktok" },
  { label: "Pinterest", value: "pinterest" },
  { label: "Snapchat", value: "snapchat" },
  { label: "Twitter/X", value: "twitter" },
];

export default function WorkspaceTemplatesPage() {
  const { shop, templates, presets, groups } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateData | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateDescription, setNewTemplateDescription] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [applyGroupId, setApplyGroupId] = useState<string>("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [applyResult, setApplyResult] = useState<any>(null);

  const isSubmitting = navigation.state === "submitting";
  const actionData = useActionData<typeof action>();

  useEffect(() => {
    if (actionData?.success && actionData.actionType === "apply_template" && actionData.result) {
      setApplyResult(actionData.result);
      setShowApplyModal(false);
      revalidator.revalidate();
    }
  }, [actionData, revalidator]);

  const handleCreateTemplate = useCallback(() => {
    if (!newTemplateName.trim() || selectedPlatforms.length === 0) return;

    const platforms: PixelTemplateConfig[] = selectedPlatforms.map((p) => ({
      platform: p,
      clientSideEnabled: true,
      serverSideEnabled: true,
    }));

    const formData = new FormData();
    formData.append("_action", "create_template");
    formData.append("name", newTemplateName.trim());
    formData.append("description", newTemplateDescription.trim());
    formData.append("platforms", JSON.stringify(platforms));
    submit(formData, { method: "post" });

    setShowCreateModal(false);
    setNewTemplateName("");
    setNewTemplateDescription("");
    setSelectedPlatforms([]);
  }, [newTemplateName, newTemplateDescription, selectedPlatforms, submit]);

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      if (!confirm("确定要删除此模板吗？")) return;

      const formData = new FormData();
      formData.append("_action", "delete_template");
      formData.append("templateId", templateId);
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const handleApplyTemplate = useCallback(() => {
    if (!selectedTemplate) return;

    const formData = new FormData();
    formData.append("_action", "apply_template");
    formData.append("templateId", selectedTemplate.id);
    if (applyGroupId) {
      formData.append("groupId", applyGroupId);
    }
    formData.append("overwrite", overwriteExisting.toString());
    submit(formData, { method: "post" });

    setShowApplyModal(false);
    setSelectedTemplate(null);
    setApplyGroupId("");
    setOverwriteExisting(false);
  }, [selectedTemplate, applyGroupId, overwriteExisting, submit]);

  const handleApplyPreset = useCallback(
    (presetId: string) => {
      const formData = new FormData();
      formData.append("_action", "apply_preset");
      formData.append("presetId", presetId);
      formData.append("overwrite", "false");
      submit(formData, { method: "post" });
    },
    [submit]
  );

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((p) => p !== platform)
        : [...prev, platform]
    );
  }, []);

  if (!shop) {
    return (
      <Page title="像素模板">
        <Banner tone="critical">
          <Text as="p">店铺信息加载失败</Text>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="像素模板"
      subtitle="创建和管理可复用的像素配置模板"
      backAction={{ url: "/app/workspace" }}
      primaryAction={{
        content: "创建模板",
        icon: PlusIcon,
        onAction: () => setShowCreateModal(true),
      }}
    >
      <BlockStack gap="500">
        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                🎨 系统预设模板
              </Text>
              <Badge tone="info">快速开始</Badge>
            </InlineStack>

            <Text as="p" variant="bodySm" tone="subdued">
              选择一个预设模板快速配置常见的追踪平台组合
            </Text>

            <Divider />

            <BlockStack gap="300">
              {presets.map((preset) => (
                <Box
                  key={preset.id}
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Text as="span" fontWeight="semibold">
                          {preset.name}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ({preset.nameEn})
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {preset.description}
                      </Text>
                      <InlineStack gap="100">
                        {preset.platforms.map((p) => (
                          <Badge key={p.platform}>
                            {PLATFORM_OPTIONS.find((o) => o.value === p.platform)?.label ||
                              p.platform}
                          </Badge>
                        ))}
                      </InlineStack>
                    </BlockStack>
                    <Button
                      onClick={() => handleApplyPreset(preset.id)}
                      loading={isSubmitting}
                      size="slim"
                    >
                      应用到当前店铺
                    </Button>
                  </InlineStack>
                </Box>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                📋 我的模板
              </Text>
              <Button onClick={() => setShowCreateModal(true)} icon={PlusIcon} size="slim">
                创建模板
              </Button>
            </InlineStack>

            <Divider />

            {templates.length === 0 ? (
              <EnhancedEmptyState
                icon="📋"
                title="暂无模板"
                description="创建自定义模板后，可以批量应用到分组中的多个店铺。"
                primaryAction={{
                  content: "创建模板",
                  onAction: () => setShowCreateModal(true),
                }}
              />
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "numeric", "text"]}
                headings={["名称", "平台", "使用次数", "操作"]}
                rows={templates.map((t) => [
                  <BlockStack key={t.id} gap="100">
                    <Text as="span" fontWeight="semibold">
                      {t.name}
                    </Text>
                    {t.description && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        {t.description}
                      </Text>
                    )}
                  </BlockStack>,
                  <InlineStack key={`platforms-${t.id}`} gap="100" wrap>
                    {t.platforms.map((p) => (
                      <Badge key={p.platform}>{p.platform}</Badge>
                    ))}
                  </InlineStack>,
                  t.usageCount,
                  <InlineStack key={`actions-${t.id}`} gap="200">
                    <Button
                      size="slim"
                      onClick={() => {
                        // t 已经是 TemplateData 类型，不需要类型断言
                        setSelectedTemplate(t);
                        setShowApplyModal(true);
                      }}
                    >
                      应用
                    </Button>
                    <Button
                      size="slim"
                      tone="critical"
                      variant="plain"
                      onClick={() => handleDeleteTemplate(t.id)}
                      icon={DeleteIcon}
                    />
                  </InlineStack>,
                ])}
              />
            )}
          </BlockStack>
        </Card>

        {}
        {applyResult && (
          <BatchApplyProgress
            total={applyResult.totalShops}
            completed={applyResult.successCount + applyResult.failedCount + applyResult.skippedCount}
            success={applyResult.successCount}
            failed={applyResult.failedCount}
            skipped={applyResult.skippedCount}
            results={applyResult.results || []}
            isRunning={false}
          />
        )}

        {}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              💡 使用说明
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span">
                  <strong>模板只包含配置结构</strong>：启用哪些平台、事件映射等，不包含 API 凭证
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span">
                  <strong>应用模板后</strong>：需要在各店铺单独配置 API Key / Access Token
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span">
                  <strong>批量应用</strong>：选择一个分组，将模板同时应用到分组内所有店铺
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Card>
      </BlockStack>

      {}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="创建像素模板"
        primaryAction={{
          content: "创建",
          onAction: handleCreateTemplate,
          loading: isSubmitting,
          disabled: !newTemplateName.trim() || selectedPlatforms.length === 0,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowCreateModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="模板名称"
              value={newTemplateName}
              onChange={setNewTemplateName}
              placeholder="例如：电商标准追踪套件"
              autoComplete="off"
            />

            <TextField
              label="描述（可选）"
              value={newTemplateDescription}
              onChange={setNewTemplateDescription}
              placeholder="模板的用途说明"
              multiline={2}
              autoComplete="off"
            />

            <BlockStack gap="200">
              <Text as="span" variant="bodySm">
                选择平台
              </Text>
              <InlineStack gap="200" wrap>
                {PLATFORM_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    pressed={selectedPlatforms.includes(option.value)}
                    onClick={() => togglePlatform(option.value)}
                    size="slim"
                  >
                    {option.label}
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {}
      <Modal
        open={showApplyModal}
        onClose={() => setShowApplyModal(false)}
        title={`应用模板: ${selectedTemplate?.name || ""}`}
        primaryAction={{
          content: "应用",
          onAction: handleApplyTemplate,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "取消",
            onAction: () => setShowApplyModal(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Select
              label="目标分组"
              options={[
                { label: "仅当前店铺", value: "" },
                ...groups.map((g) => ({
                  label: `${g.name} (${g.memberCount} 个店铺)`,
                  value: g.id,
                })),
              ]}
              value={applyGroupId}
              onChange={setApplyGroupId}
            />

            <Checkbox
              label="覆盖已存在的配置"
              checked={overwriteExisting}
              onChange={setOverwriteExisting}
              helpText="如果店铺已有相同平台的配置，是否覆盖"
            />

            <Banner tone="info">
              <Text as="p" variant="bodySm">
                应用模板后，需要在各店铺单独配置 API 凭证才能启用追踪
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
