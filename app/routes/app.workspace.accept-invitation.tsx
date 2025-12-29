

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Box,
  Divider,
  Badge,
  List,
} from "@shopify/polaris";
import { useToastContext, EnhancedEmptyState } from "~/components/ui";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getInvitationByToken,
  acceptInvitation,
  declineInvitation,
  type WorkspaceInvitation,
} from "../services/workspace-invitation.server";

interface LoaderData {
  invitation: WorkspaceInvitation | null;
  error?: string;
  shop: {
    id: string;
    shopDomain: string;
  } | null;
  alreadyMember: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return json<LoaderData>({
      invitation: null,
      error: "缺少邀请令牌",
      shop: null,
      alreadyMember: false,
    });
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });

  if (!shop) {
    return json<LoaderData>({
      invitation: null,
      error: "店铺未找到",
      shop: null,
      alreadyMember: false,
    });
  }

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return json<LoaderData>({
      invitation: null,
      error: "邀请不存在或已失效",
      shop,
      alreadyMember: false,
    });
  }

  const existingMember = await prisma.shopGroupMember.findFirst({
    where: {
      groupId: invitation.groupId,
      shopId: shop.id,
    },
  });

  return json<LoaderData>({
    invitation,
    shop,
    alreadyMember: !!existingMember,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const token = formData.get("token") as string;

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "店铺未找到" }, { status: 404 });
  }

  if (actionType === "accept") {
    const result = await acceptInvitation(token, shop.id);
    if (result.success) {
      return redirect(`/app/workspace?groupId=${result.groupId}&joined=true`);
    }
    return json({ error: result.message }, { status: 400 });
  }

  if (actionType === "decline") {
    const result = await declineInvitation(token, shop.id);
    if (result.success) {
      return redirect("/app/workspace?declined=true");
    }
    return json({ error: result.message }, { status: 400 });
  }

  return json({ error: "未知操作" }, { status: 400 });
};

export default function AcceptInvitationPage() {
  const { invitation, error, shop, alreadyMember } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const { showSuccess, showError } = useToastContext();

  const isSubmitting = navigation.state === "submitting";

  const handleAccept = () => {
    if (!invitation) return;
    const formData = new FormData();
    formData.append("_action", "accept");
    formData.append("token", invitation.token);
    submit(formData, { method: "post" });
  };

  const handleDecline = () => {
    if (!invitation) return;
    const formData = new FormData();
    formData.append("_action", "decline");
    formData.append("token", invitation.token);
    submit(formData, { method: "post" });
  };

  if (error || !invitation) {
    return (
      <Page title="邀请无效">
        <EnhancedEmptyState
          icon="⚠️"
          title="邀请无效"
          description={error || "邀请不存在或已失效"}
          primaryAction={{
            content: "返回工作区",
            url: "/app/workspace",
          }}
        />
      </Page>
    );
  }

  if (alreadyMember) {
    return (
      <Page title="已是成员">
        <EnhancedEmptyState
          icon="✅"
          title="已是成员"
          description={`您已经是「${invitation.groupName}」的成员。`}
          primaryAction={{
            content: "查看工作区",
            url: `/app/workspace?groupId=${invitation.groupId}`,
          }}
        />
      </Page>
    );
  }

  if (invitation.status === "expired") {
    return (
      <Page title="邀请已过期">
        <EnhancedEmptyState
          icon="⏰"
          title="邀请已过期"
          description={`此邀请已于 ${new Date(invitation.expiresAt).toLocaleDateString("zh-CN")} 过期。请联系 ${invitation.inviterDomain} 重新发送邀请。`}
          primaryAction={{
            content: "返回工作区",
            url: "/app/workspace",
          }}
        />
      </Page>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <Page title="邀请状态无效">
        <EnhancedEmptyState
          icon="⚠️"
          title="邀请状态无效"
          description={`此邀请状态为「${invitation.status}」，无法操作。`}
          primaryAction={{
            content: "返回工作区",
            url: "/app/workspace",
          }}
        />
      </Page>
    );
  }

  return (
    <Page title="接受工作区邀请">
      <Card>
        <BlockStack gap="500">
          {}
          <BlockStack gap="200">
            <InlineStack align="center" gap="300">
              <Text as="span" variant="headingXl">
                🎉
              </Text>
              <Text as="h1" variant="headingLg">
                您收到了一个邀请
              </Text>
            </InlineStack>
            <Text as="p" tone="subdued">
              <strong>{invitation.inviterDomain}</strong> 邀请您加入他们的 Tracking Guardian 工作区。
            </Text>
          </BlockStack>

          <Divider />

          {}
          <Box background="bg-surface-secondary" padding="400" borderRadius="200">
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  工作区名称
                </Text>
                <Text as="span" fontWeight="semibold">
                  {invitation.groupName}
                </Text>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  邀请者
                </Text>
                <Text as="span" fontWeight="semibold">
                  {invitation.inviterDomain}
                </Text>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  您的角色
                </Text>
                <Badge tone={invitation.role === "admin" ? "success" : "info"}>
                  {invitation.role === "admin" ? "管理员" : "成员"}
                </Badge>
              </InlineStack>

              <InlineStack align="space-between">
                <Text as="span" tone="subdued">
                  有效期至
                </Text>
                <Text as="span">
                  {new Date(invitation.expiresAt).toLocaleDateString("zh-CN")}
                </Text>
              </InlineStack>
            </BlockStack>
          </Box>

          {}
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              您将获得的权限
            </Text>
            <List type="bullet">
              {invitation.permissions.canViewReports && (
                <List.Item>查看分组报告和数据</List.Item>
              )}
              {invitation.permissions.canEditSettings && (
                <List.Item>编辑分组设置和配置</List.Item>
              )}
              {invitation.permissions.canManageBilling && (
                <List.Item>管理账单和订阅</List.Item>
              )}
            </List>
          </BlockStack>

          <Divider />

          {}
          <Banner tone="info">
            <Text as="p" variant="bodySm">
              您将以 <strong>{shop?.shopDomain}</strong> 的身份加入此工作区。
            </Text>
          </Banner>

          {}
          <InlineStack gap="300" align="end">
            <Button
              onClick={handleDecline}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              拒绝
            </Button>
            <Button
              variant="primary"
              onClick={handleAccept}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              接受邀请
            </Button>
          </InlineStack>
        </BlockStack>
      </Card>
    </Page>
  );
}

