import { useState, useCallback } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  DataTable,
  Badge,
  Modal,
  TextField,
  Select,
  Banner,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon, EditIcon } from "~/components/icons";
import type { WorkspaceMember } from "@prisma/client";

export interface WorkspaceMembersProps {
  members: WorkspaceMember[];
  currentUserId: string;
  currentUserRole: "owner" | "admin" | "viewer";
  onInvite?: (email: string, role: "admin" | "viewer") => Promise<void>;
  onUpdateRole?: (memberId: string, role: "admin" | "viewer") => Promise<void>;
  onRemove?: (memberId: string) => Promise<void>;
}

export function WorkspaceMembers({
  members,
  currentUserId,
  currentUserRole,
  onInvite,
  onUpdateRole,
  onRemove,
}: WorkspaceMembersProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "viewer">("viewer");
  const [isInviting, setIsInviting] = useState(false);

  const canManageMembers = currentUserRole === "owner" || currentUserRole === "admin";

  const handleInvite = useCallback(async () => {
    if (!onInvite || !inviteEmail.trim()) return;

    setIsInviting(true);
    try {
      await onInvite(inviteEmail.trim(), inviteRole);
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("viewer");
    } finally {
      setIsInviting(false);
    }
  }, [onInvite, inviteEmail, inviteRole]);

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return <Badge tone="info">Owner</Badge>;
      case "admin":
        return <Badge tone="success">Admin</Badge>;
      case "viewer":
        return <Badge>Viewer</Badge>;
      default:
        return <Badge>{role}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return <Badge tone="success">已接受</Badge>;
      case "pending":
        return <Badge tone="warning">待接受</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" as="h2">
              团队成员
            </Text>
            {canManageMembers && (
              <Button
                icon={PlusIcon}
                onClick={() => setShowInviteModal(true)}
                variant="primary"
              >
                邀请成员
              </Button>
            )}
          </InlineStack>

          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text"]}
            headings={["邮箱", "角色", "状态", "加入时间", "操作"]}
            rows={members.map((member) => [
              member.email,
              getRoleBadge(member.role),
              getStatusBadge(member.inviteStatus),
              member.acceptedAt
                ? new Date(member.acceptedAt).toLocaleDateString("zh-CN")
                : member.invitedAt
                ? `邀请于 ${new Date(member.invitedAt).toLocaleDateString("zh-CN")}`
                : "-",
              canManageMembers && member.userId !== currentUserId ? (
                <InlineStack gap="100">
                  {onUpdateRole && (
                    <Button
                      size="micro"
                      onClick={() => {

                      }}
                    >
                      编辑
                    </Button>
                  )}
                  {onRemove && (
                    <Button
                      size="micro"
                      tone="critical"
                      onClick={() => {

                      }}
                    >
                      移除
                    </Button>
                  )}
                </InlineStack>
              ) : (
                "-"
              ),
            ])}
          />
        </BlockStack>
      </Card>

      {showInviteModal && (
        <Modal
          open={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          title="邀请团队成员"
          primaryAction={{
            content: "发送邀请",
            onAction: handleInvite,
            loading: isInviting,
          }}
          secondaryActions={[
            {
              content: "取消",
              onAction: () => setShowInviteModal(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="邮箱地址"
                value={inviteEmail}
                onChange={setInviteEmail}
                type="email"
                helpText="将向该邮箱发送邀请链接"
                autoComplete="off"
              />
              <Select
                label="角色"
                options={[
                  { label: "Viewer - 仅查看", value: "viewer" },
                  { label: "Admin - 可编辑", value: "admin" },
                ]}
                value={inviteRole}
                onChange={(value) => setInviteRole(value as "admin" | "viewer")}
              />
              <Banner tone="info">
                <Text variant="bodySm" as="span">
                  Viewer 只能查看报告和数据，Admin 可以编辑配置和管理店铺。
                </Text>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </BlockStack>
  );
}
