
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation, useActionData } from "@remix-run/react";
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
  Banner,
  Box,
  DataTable,
  Modal,
  TextField,
  Checkbox,
  EmptyState,
  Divider,
} from "@shopify/polaris";
import { EditIcon, DeleteIcon, ShareIcon, CheckCircleIcon } from "~/components/icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getPixelTemplates,
  createPixelTemplate,
  updatePixelTemplate,
  deletePixelTemplate,
  type PixelTemplateConfig,
} from "../services/batch-pixel-apply.server";
import { getWizardTemplates, generateTemplateShareLink, saveWizardConfigAsTemplate } from "../services/pixel-template.server";
import { useToastContext, EnhancedEmptyState } from "~/components/ui";
import { logger } from "../utils/logger.server";
import { getPlanDefinition, normalizePlan, isPlanAtLeast } from "../utils/plans";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      plan: true,
    },
  });

  if (!shop) {
    return json({
      shop: null,
      templates: [],
      planId: "free" as const,
      canManageTemplates: false,
    });
  }

  const planId = normalizePlan(shop.plan);
  const canManageTemplates = isPlanAtLeast(planId, "agency");

  const templates = await getPixelTemplates(shop.id, true);

  const workspace = await prisma.workspace.findFirst({
    where: {
      members: {
        some: {
          shopId: shop.id,
          role: { in: ["owner", "admin"] },
        },
      },
    },
    select: {
      id: true,
      name: true,
      members: {
        select: {
          shopId: true,
          role: true,
        },
      },
    },
  });

  return json({
    shop: { id: shop.id, domain: shopDomain },
    templates,
    planId,
    canManageTemplates: canManageTemplates || !!workspace,
    isAgency: !!workspace,
    workspaceId: workspace?.id,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true },
  });

  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const actionType = formData.get("_action");

  const planId = normalizePlan(shop.plan);
  const canManageTemplates = isPlanAtLeast(planId, "agency");

  if (!canManageTemplates) {
    return json(
      { success: false, error: "模板管理功能需要 Agency 套餐" },
      { status: 403 }
    );
  }

  if (actionType === "createTemplate") {
    try {
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const platformsJson = formData.get("platforms") as string;
      const isPublic = formData.get("isPublic") === "true";

      if (!name || !platformsJson) {
        return json({ success: false, error: "缺少必要参数" }, { status: 400 });
      }

      const platforms = JSON.parse(platformsJson) as PixelTemplateConfig[];

      const result = await createPixelTemplate({
        ownerId: shop.id,
        name,
        description: description || undefined,
        platforms,
        isPublic,
      });

      if (result.success) {
        logger.info("Template created", { templateId: result.templateId, shopId: shop.id });
      }

      return json(result);
    } catch (error) {
      logger.error("Failed to create template", error);
      return json(
        { success: false, error: error instanceof Error ? error.message : "创建失败" },
        { status: 500 }
      );
    }
  }

  if (actionType === "updateTemplate") {
    try {
      const templateId = formData.get("templateId") as string;
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const platformsJson = formData.get("platforms") as string;
      const isPublic = formData.get("isPublic") === "true";

      if (!templateId || !name || !platformsJson) {
        return json({ success: false, error: "缺少必要参数" }, { status: 400 });
      }

      const platforms = JSON.parse(platformsJson) as PixelTemplateConfig[];

      const result = await updatePixelTemplate(templateId, shop.id, {
        name,
        description: description || undefined,
        platforms,
        isPublic,
      });

      return json(result);
    } catch (error) {
      logger.error("Failed to update template", error);
      return json(
        { success: false, error: error instanceof Error ? error.message : "更新失败" },
        { status: 500 }
      );
    }
  }

  if (actionType === "deleteTemplate") {
    try {
      const templateId = formData.get("templateId") as string;

      if (!templateId) {
        return json({ success: false, error: "缺少模板 ID" }, { status: 400 });
      }

      const result = await deletePixelTemplate(templateId, shop.id);

      return json(result);
    } catch (error) {
      logger.error("Failed to delete template", error);
      return json(
        { success: false, error: error instanceof Error ? error.message : "删除失败" },
        { status: 500 }
      );
    }
  }

  if (actionType === "generateShareLink") {
    try {
      const templateId = formData.get("templateId") as string;

      if (!templateId) {
        return json({ success: false, error: "缺少模板 ID" }, { status: 400 });
      }

      const result = await generateTemplateShareLink(templateId, shop.id);

      if (result.success && result.shareLink) {
        const baseUrl = process.env.SHOPIFY_APP_URL || "https://example.com";
        const fullShareLink = `${baseUrl}${result.shareLink}`;
        return json({ success: true, shareLink: fullShareLink });
      }

      return json(result);
    } catch (error) {
      logger.error("Failed to generate share link", error);
      return json(
        { success: false, error: error instanceof Error ? error.message : "生成分享链接失败" },
        { status: 500 }
      );
    }
  }

  if (actionType === "saveWizardConfigAsTemplate") {
    try {
      const name = formData.get("name") as string;
      const description = formData.get("description") as string;
      const platformsJson = formData.get("platforms") as string;
      const eventMappingsJson = formData.get("eventMappings") as string;
      const isPublic = formData.get("isPublic") === "true";

      if (!name || !platformsJson || !eventMappingsJson) {
        return json({ success: false, error: "缺少必要参数" }, { status: 400 });
      }

      const platforms = JSON.parse(platformsJson) as string[];
      const eventMappings = JSON.parse(eventMappingsJson) as Record<string, Record<string, string>>;

      const result = await saveWizardConfigAsTemplate(
        shop.id,
        name,
        description || undefined,
        platforms,
        eventMappings,
        isPublic
      );

      return json(result);
    } catch (error) {
      logger.error("Failed to save wizard config as template", error);
      return json(
        { success: false, error: error instanceof Error ? error.message : "保存模板失败" },
        { status: 500 }
      );
    }
  }

  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

export default function TemplatesPage() {
  const { shop, templates, planId, canManageTemplates, isAgency } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  const [editingTemplate, setEditingTemplate] = useState<typeof templates[0] | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateIsPublic, setTemplateIsPublic] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [previewingTemplate, setPreviewingTemplate] = useState<typeof templates[0] | null>(null);
  const [sharingTemplate, setSharingTemplate] = useState<typeof templates[0] | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);

  const planDef = getPlanDefinition(planId);

  if (actionData) {
    if (actionData.success) {
      showSuccess(actionData.message || "操作成功");
      if (editingTemplate || showCreateModal) {
        setEditingTemplate(null);
        setShowCreateModal(false);
        setTemplateName("");
        setTemplateDescription("");
        setTemplateIsPublic(false);
      }
    } else if (actionData.error) {
      showError(actionData.error);
    }
  }

  const handleCreateTemplate = useCallback(() => {

    setShowCreateModal(true);
  }, []);

  const handleEditTemplate = useCallback((template: typeof templates[0]) => {
    setEditingTemplate(template);
    setTemplateName(template.name);
    setTemplateDescription(template.description || "");
    setTemplateIsPublic(template.isPublic);
  }, []);

  const handleDeleteTemplate = useCallback((templateId: string) => {
    if (confirm("确定要删除此模板吗？此操作不可撤销。")) {
      setDeletingTemplateId(templateId);
      const formData = new FormData();
      formData.append("_action", "deleteTemplate");
      formData.append("templateId", templateId);
      submit(formData, { method: "post" });
    }
  }, [submit]);

  const handlePreviewTemplate = useCallback((template: typeof templates[0]) => {
    setPreviewingTemplate(template);
  }, []);

  const handleApplyTemplate = useCallback((template: typeof templates[0]) => {

    if (typeof window !== "undefined") {
      sessionStorage.setItem("applyTemplateId", template.id);
      window.location.href = "/app/migrate?applyTemplate=" + template.id;
    }
  }, []);

  const handleShareTemplate = useCallback(async (template: typeof templates[0]) => {
    setSharingTemplate(template);
    setIsGeneratingShareLink(true);
    setShareLink(null);

    try {
      const formData = new FormData();
      formData.append("_action", "generateShareLink");
      formData.append("templateId", template.id);

      const response = await fetch("/app/templates", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success && data.shareLink) {
        setShareLink(data.shareLink);
      } else {
        showError(data.error || "生成分享链接失败");
      }
    } catch (error) {
      showError("生成分享链接失败");
      // Log error in development only
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.error("Share link generation error", error);
      }
    } finally {
      setIsGeneratingShareLink(false);
    }
  }, [showError]);

  const handleCopyShareLink = useCallback(async () => {
    if (!shareLink) return;

    try {
      await navigator.clipboard.writeText(shareLink);
      showSuccess("分享链接已复制到剪贴板");
    } catch (error) {
      showError("复制失败，请手动复制");
      // Log error in development only
      if (process.env.NODE_ENV === "development") {
        // eslint-disable-next-line no-console
        console.error("Copy error", error);
      }
    }
  }, [shareLink, showSuccess, showError]);

  const handleSaveTemplate = useCallback(() => {
    if (!templateName.trim()) {
      showError("请输入模板名称");
      return;
    }

    const platforms: PixelTemplateConfig[] = [
      {
        platform: "google",
        eventMappings: {
          checkout_completed: "purchase",
        },
        clientSideEnabled: true,
        serverSideEnabled: true,
      },
    ];

    const formData = new FormData();
    formData.append("_action", editingTemplate ? "updateTemplate" : "createTemplate");
    if (editingTemplate) {
      formData.append("templateId", editingTemplate.id);
    }
    formData.append("name", templateName);
    formData.append("description", templateDescription);
    formData.append("platforms", JSON.stringify(platforms));
    formData.append("isPublic", templateIsPublic.toString());

    submit(formData, { method: "post" });
  }, [templateName, templateDescription, templateIsPublic, editingTemplate, submit, showError]);

  const myTemplates = templates.filter((t) => t.id.startsWith("clx") || !t.isPublic);
  const publicTemplates = templates.filter((t) => t.isPublic && !myTemplates.includes(t));

  if (!shop) {
    return (
      <Page title="模板库">
        <EnhancedEmptyState
          icon="⚠️"
          title="店铺信息未找到"
          description="未找到店铺信息，请重新安装应用。"
        />
      </Page>
    );
  }

  if (!canManageTemplates) {
    return (
      <Page title="模板库">
        <Banner tone="warning">
          <BlockStack gap="200">
            <Text as="p" fontWeight="semibold">
              模板管理功能需要 Agency 套餐
            </Text>
            <Text as="p" variant="bodySm">
              模板库功能允许您保存、编辑和分享像素配置模板，方便批量应用到多个店铺。
              升级到 Agency 套餐以解锁此功能。
            </Text>
            <Button url="/app/settings?tab=subscription" variant="primary">
              升级套餐
            </Button>
          </BlockStack>
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="像素配置模板库"
      primaryAction={{
        content: "创建模板",
        onAction: handleCreateTemplate,
      }}
    >
      <BlockStack gap="500">
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              模板库功能说明
            </Text>
            <Text as="p" variant="bodySm">
              模板库允许您保存常用的像素配置，方便快速应用到多个店铺。
              您可以创建私有模板（仅自己可见）或公开模板（团队可见）。
            </Text>
          </BlockStack>
        </Banner>

        {}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                我的模板
              </Text>
              <Badge tone="info">{myTemplates.length} 个</Badge>
            </InlineStack>

            {myTemplates.length === 0 ? (
              <EmptyState
                heading="还没有创建模板"
                action={{
                  content: "创建第一个模板",
                  onAction: handleCreateTemplate,
                }}
              >
                <Text as="p" variant="bodySm" tone="subdued">
                  创建模板后，您可以快速应用到多个店铺。
                </Text>
              </EmptyState>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["模板名称", "描述", "平台", "使用次数", "操作"]}
                rows={myTemplates.map((template) => {
                  const platforms = (template.platforms as PixelTemplateConfig[]) || [];
                  return [
                    <InlineStack key="name" gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {template.name}
                      </Text>
                      {template.isPublic && (
                        <Badge tone="success">公开</Badge>
                      )}
                    </InlineStack>,
                    template.description || "-",
                    platforms.map((p) => p.platform).join(", ") || "-",
                    String(template.usageCount),
                    <InlineStack key="actions" gap="200">
                      <Button
                        size="slim"
                        variant="primary"
                        onClick={() => handleApplyTemplate(template)}
                      >
                        应用到当前店铺
                      </Button>
                      {isAgency && (
                        <Button
                          size="slim"
                          onClick={() => {

                            window.location.href = `/app/workspace/templates?templateId=${template.id}`;
                          }}
                        >
                          批量应用
                        </Button>
                      )}
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => handlePreviewTemplate(template)}
                      >
                        预览
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        icon={ShareIcon}
                        onClick={() => handleShareTemplate(template)}
                      >
                        分享
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        icon={EditIcon}
                        onClick={() => handleEditTemplate(template)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        icon={DeleteIcon}
                        onClick={() => handleDeleteTemplate(template.id)}
                        loading={deletingTemplateId === template.id}
                      >
                        删除
                      </Button>
                    </InlineStack>,
                  ];
                })}
              />
            )}
          </BlockStack>
        </Card>

        {}
        {publicTemplates.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  公开模板
                </Text>
                <Badge tone="info">{publicTemplates.length} 个</Badge>
              </InlineStack>

              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["模板名称", "描述", "平台", "使用次数", "操作"]}
                rows={publicTemplates.map((template) => {
                  const platforms = (template.platforms as PixelTemplateConfig[]) || [];
                  return [
                    <InlineStack key="name" gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        {template.name}
                      </Text>
                      <Badge tone="success">公开</Badge>
                    </InlineStack>,
                    template.description || "-",
                    platforms.map((p) => p.platform).join(", ") || "-",
                    String(template.usageCount),
                    <InlineStack key="actions" gap="200">
                      <Button
                        size="slim"
                        variant="primary"
                        onClick={() => handleApplyTemplate(template)}
                      >
                        应用
                      </Button>
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => handlePreviewTemplate(template)}
                      >
                        预览
                      </Button>
                    </InlineStack>,
                  ];
                })}
              />
            </BlockStack>
          </Card>
        )}

        {}
        <Modal
          open={showCreateModal || editingTemplate !== null}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTemplate(null);
            setTemplateName("");
            setTemplateDescription("");
            setTemplateIsPublic(false);
          }}
          title={editingTemplate ? "编辑模板" : "创建模板"}
          primaryAction={{
            content: "保存",
            onAction: handleSaveTemplate,
            loading: navigation.state === "submitting",
          }}
          secondaryActions={[
            {
              content: "取消",
              onAction: () => {
                setShowCreateModal(false);
                setEditingTemplate(null);
                setTemplateName("");
                setTemplateDescription("");
                setTemplateIsPublic(false);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="模板名称"
                value={templateName}
                onChange={setTemplateName}
                autoComplete="off"
                helpText="为模板起一个易于识别的名称"
              />
              <TextField
                label="描述"
                value={templateDescription}
                onChange={setTemplateDescription}
                multiline={3}
                autoComplete="off"
                helpText="描述此模板的用途和适用场景"
              />
              <Checkbox
                label="设为公开模板"
                checked={templateIsPublic}
                onChange={setTemplateIsPublic}
                helpText="公开模板可以被团队其他成员查看和使用"
              />
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  注意：模板仅保存事件映射和平台配置，不包含 API 凭证等敏感信息。
                  每个店铺需要单独配置凭证。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {}
        <Modal
          open={sharingTemplate !== null}
          onClose={() => {
            setSharingTemplate(null);
            setShareLink(null);
          }}
          title={sharingTemplate ? `分享模板：${sharingTemplate.name}` : ""}
          primaryAction={{
            content: shareLink ? "复制链接" : "生成链接",
            onAction: shareLink ? handleCopyShareLink : () => handleShareTemplate(sharingTemplate!),
            loading: isGeneratingShareLink,
          }}
          secondaryActions={[
            {
              content: "关闭",
              onAction: () => {
                setSharingTemplate(null);
                setShareLink(null);
              },
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              {sharingTemplate && (
                <>
                  <Banner tone="info">
                    <Text as="p" variant="bodySm">
                      分享链接可以让其他用户通过链接导入此模板。链接包含模板 ID 和验证 token，确保安全性。
                    </Text>
                  </Banner>

                  {shareLink ? (
                    <BlockStack gap="300">
                      <TextField
                        label="分享链接"
                        value={shareLink}
                        readOnly
                        helpText="复制此链接并分享给其他用户，他们可以通过此链接导入模板"
                      />
                      <Button
                        variant="primary"
                        onClick={handleCopyShareLink}
                        icon={ShareIcon}
                      >
                        复制链接
                      </Button>
                      <Banner tone="success">
                        <Text as="p" variant="bodySm">
                          ✅ 链接已生成。您可以将此链接分享给团队成员或其他店铺。
                        </Text>
                      </Banner>
                    </BlockStack>
                  ) : (
                    <Banner tone="info">
                      <Text as="p" variant="bodySm">
                        点击「生成链接」按钮创建分享链接。
                      </Text>
                    </Banner>
                  )}

                  <Divider />

                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">
                      模板信息
                    </Text>
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          名称：
                        </Text>
                        <Text as="span" fontWeight="semibold">
                          {sharingTemplate.name}
                        </Text>
                      </InlineStack>
                      {sharingTemplate.description && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            描述：
                          </Text>
                          <Text as="span" variant="bodySm">
                            {sharingTemplate.description}
                          </Text>
                        </BlockStack>
                      )}
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          使用次数：
                        </Text>
                        <Badge>{sharingTemplate.usageCount}</Badge>
                      </InlineStack>
                    </BlockStack>
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>

        {}
        <Modal
          open={previewingTemplate !== null}
          onClose={() => setPreviewingTemplate(null)}
          title={previewingTemplate ? `预览模板：${previewingTemplate.name}` : ""}
          primaryAction={{
            content: "应用到当前店铺",
            onAction: () => {
              if (previewingTemplate) {
                handleApplyTemplate(previewingTemplate);
                setPreviewingTemplate(null);
              }
            },
          }}
          secondaryActions={[
            {
              content: "关闭",
              onAction: () => setPreviewingTemplate(null),
            },
          ]}
        >
          <Modal.Section>
            {previewingTemplate && (
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    模板信息
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        名称：
                      </Text>
                      <Text as="span">{previewingTemplate.name}</Text>
                    </InlineStack>
                    {previewingTemplate.description && (
                      <BlockStack gap="100">
                        <Text as="span" fontWeight="semibold">
                          描述：
                        </Text>
                        <Text as="span" tone="subdued">
                          {previewingTemplate.description}
                        </Text>
                      </BlockStack>
                    )}
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        使用次数：
                      </Text>
                      <Badge>{previewingTemplate.usageCount}</Badge>
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" fontWeight="semibold">
                        类型：
                      </Text>
                      <Badge tone={previewingTemplate.isPublic ? "success" : "info"}>
                        {previewingTemplate.isPublic ? "公开模板" : "私有模板"}
                      </Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    平台配置
                  </Text>
                  {(() => {
                    const platforms = (previewingTemplate.platforms as PixelTemplateConfig[]) || [];
                    if (platforms.length === 0) {
                      return (
                        <Banner tone="info">
                          <Text as="p" variant="bodySm">
                            此模板未包含任何平台配置
                          </Text>
                        </Banner>
                      );
                    }

                    return platforms.map((platformConfig, index) => (
                      <Card key={index}>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="span" fontWeight="semibold">
                              {platformConfig.platform.toUpperCase()}
                            </Text>
                            <InlineStack gap="200">
                              {platformConfig.clientSideEnabled && (
                                <Badge tone="info">客户端</Badge>
                              )}
                              {platformConfig.serverSideEnabled && (
                                <Badge tone="success">服务端</Badge>
                              )}
                            </InlineStack>
                          </InlineStack>

                          {platformConfig.eventMappings && (
                            <BlockStack gap="200">
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                事件映射：
                              </Text>
                              <Box
                                padding="300"
                                background="bg-surface-secondary"
                                borderRadius="200"
                              >
                                <Box
                                  as="pre"
                                  style={{
                                    fontSize: "12px",
                                    overflow: "auto",
                                    margin: 0,
                                  }}
                                >
                                  {JSON.stringify(platformConfig.eventMappings, null, 2)}
                                </Box>
                              </Box>
                            </BlockStack>
                          )}
                        </BlockStack>
                      </Card>
                    ));
                  })()}
                </BlockStack>

                <Banner tone="info">
                  <Text as="p" variant="bodySm">
                    应用模板后，您需要在迁移向导中配置各平台的 API 凭证。模板仅包含事件映射配置，不包含敏感信息。
                  </Text>
                </Banner>
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}

