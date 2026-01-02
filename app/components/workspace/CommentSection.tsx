
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Box,
  Divider,
  Banner,
  Badge,
  Autocomplete,
} from "@shopify/polaris";
import { useState, useCallback, useMemo } from "react";
import type { CommentWithAuthor } from "~/services/task-comments.server";
import type { WorkspaceCommentWithAuthor } from "~/services/workspace-comments.server";

interface CommentSectionProps {
  comments: CommentWithAuthor[] | WorkspaceCommentWithAuthor[];
  currentShopId: string;
  currentShopDomain: string;
  onCommentCreate: (content: string, parentCommentId?: string, mentionedShopIds?: string[]) => Promise<void>;
  onCommentDelete?: (commentId: string) => Promise<void>;
  availableMembers?: Array<{
    shopId: string;
    shopDomain: string;
  }>;
}

export function CommentSection({
  comments,
  currentShopId,
  currentShopDomain,
  onCommentCreate,
  onCommentDelete,
  availableMembers = [],
}: CommentSectionProps) {
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mentionedShopIds, setMentionedShopIds] = useState<string[]>([]);

  const extractMentions = useCallback((text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const matches = Array.from(text.matchAll(mentionRegex));
    const mentionedDomains = matches.map((m) => m[1]);

    return availableMembers
      .filter((m) => mentionedDomains.some((domain) => m.shopDomain.includes(domain)))
      .map((m) => m.shopId);
  }, [availableMembers]);

  const handleSubmitComment = useCallback(async () => {
    if (!newComment.trim()) return;

    setIsSubmitting(true);
    try {
      const mentions = extractMentions(newComment);
      await onCommentCreate(newComment.trim(), undefined, mentions);
      setNewComment("");
      setMentionedShopIds([]);
    } catch (error) {

      if (process.env.NODE_ENV === "development") {
        // 客户端调试输出：创建评论失败
        // eslint-disable-next-line no-console
        console.error("Failed to create comment:", error);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [newComment, onCommentCreate, extractMentions]);

  const handleSubmitReply = useCallback(
    async (parentCommentId: string) => {
      if (!replyContent.trim()) return;

      setIsSubmitting(true);
      try {
        const mentions = extractMentions(replyContent);
        await onCommentCreate(replyContent.trim(), parentCommentId, mentions);
        setReplyContent("");
        setReplyingTo(null);
      } catch (error) {

        if (process.env.NODE_ENV === "development") {
          // 客户端调试输出：创建回复失败
          // eslint-disable-next-line no-console
          console.error("Failed to create reply:", error);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [replyContent, onCommentCreate, extractMentions]
  );

  const renderComment = (comment: CommentWithAuthor | WorkspaceCommentWithAuthor, level = 0) => {
    const isAuthor = comment.authorShopId === currentShopId;
    const indent = level * 20;

    return (
      <Box key={comment.id} paddingBlockStart={level > 0 ? "300" : "400"}>
        <Box paddingInlineStart={`${indent}px`}>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {comment.authorShopDomain}
                </Text>
                {comment.isSystemMessage && (
                  <Badge tone="info">系统消息</Badge>
                )}
                <Text as="span" variant="bodySm" tone="subdued">
                  {new Date(comment.createdAt).toLocaleString("zh-CN")}
                </Text>
              </InlineStack>
              {isAuthor && onCommentDelete && (
                <Button
                  size="slim"
                  tone="critical"
                  variant="plain"
                  onClick={() => onCommentDelete(comment.id)}
                >
                  删除
                </Button>
              )}
            </InlineStack>

            <Box background="bg-surface-secondary" padding="300" borderRadius="200">
              <Text as="p" variant="bodySm" whiteSpace="pre-wrap">
                {comment.content.split(/(@\w+)/g).map((part, idx) => {
                  if (part.startsWith("@")) {
                    const domain = part.substring(1);
                    const member = availableMembers.find((m) => m.shopDomain.includes(domain));
                    if (member) {
                      return (
                        <Badge key={idx} tone="info">
                          {part}
                        </Badge>
                      );
                    }
                  }
                  return <span key={idx}>{part}</span>;
                })}
              </Text>
            </Box>

            {!comment.isSystemMessage && (
              <InlineStack gap="200">
                {replyingTo === comment.id ? (
                  <>
                    <TextField
                      label=""
                      value={replyContent}
                      onChange={setReplyContent}
                      placeholder="输入回复..."
                      multiline={3}
                      autoComplete="off"
                    />
                    <InlineStack gap="200" blockAlign="end">
                      <Button
                        size="slim"
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyContent("");
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        size="slim"
                        variant="primary"
                        onClick={() => handleSubmitReply(comment.id)}
                        loading={isSubmitting}
                        disabled={!replyContent.trim()}
                      >
                        回复
                      </Button>
                    </InlineStack>
                  </>
                ) : (
                  <Button
                    size="slim"
                    variant="plain"
                    onClick={() => setReplyingTo(comment.id)}
                  >
                    回复
                  </Button>
                )}
              </InlineStack>
            )}

            {comment.replies && comment.replies.length > 0 && (
              <BlockStack gap="200">
                {comment.replies.map((reply) => renderComment(reply, level + 1))}
              </BlockStack>
            )}
          </BlockStack>
        </Box>
      </Box>
    );
  };

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          评论 ({comments.length})
        </Text>

        <Divider />

        {comments.length > 0 ? (
          <BlockStack gap="300">
            {comments.map((comment) => renderComment(comment))}
          </BlockStack>
        ) : (
          <Banner tone="info">
            <Text as="p">暂无评论。添加第一条评论开始讨论。</Text>
          </Banner>
        )}

        <Divider />

        <BlockStack gap="300">
          <TextField
            label="添加评论"
            value={newComment}
            onChange={setNewComment}
            placeholder="输入评论..."
            multiline={4}
            autoComplete="off"
          />
          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={handleSubmitComment}
              loading={isSubmitting}
              disabled={!newComment.trim()}
            >
              发表评论
            </Button>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

