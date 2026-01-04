
import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  TextField,
  Badge,
  Box,
  Banner,
} from "@shopify/polaris";
import { ShareIcon, CopyIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";

interface ReportShareProps {
  runId: string;
  shopId: string;
}

export function ReportShare({ runId, shopId }: ReportShareProps) {
  const { showSuccess, showError } = useToastContext();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  const handleGenerateShare = useCallback(async () => {
    setIsGenerating(true);
    try {
      const response = await fetch("/api/reports/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: "verification",
          reportId: runId,
        }),
      });

      if (!response.ok) {
        throw new Error("生成分享链接失败");
      }

      const data = await response.json();
      setShareUrl(data.shareUrl);
      setExpiresAt(new Date(data.expiresAt));
      showSuccess("分享链接已生成");
    } catch (error) {
      showError("生成分享链接失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setIsGenerating(false);
    }
  }, [runId, showSuccess, showError]);

  const handleCopyUrl = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    showSuccess("链接已复制到剪贴板");
  }, [shareUrl, showSuccess]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            分享报告
          </Text>
          <Badge tone="info">7 天有效</Badge>
        </InlineStack>

        {!shareUrl ? (
          <BlockStack gap="300">
            <Text as="p" tone="subdued">
              生成一个可分享的链接，其他人可以通过此链接查看验收报告（无需登录）。
            </Text>
            <Button
              icon={ShareIcon}
              onClick={handleGenerateShare}
              loading={isGenerating}
            >
              生成分享链接
            </Button>
          </BlockStack>
        ) : (
          <BlockStack gap="300">
            <Banner tone="success">
              <Text as="p">分享链接已生成，7 天后自动过期</Text>
            </Banner>

            <Box background="bg-surface-secondary" padding="400" borderRadius="200">
              <BlockStack gap="200">
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  分享链接
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Box style={{ minWidth: 0, flex: "1 1 0%" }}>
                    <TextField
                      value={shareUrl || ""}
                      readOnly
                    />
                  </Box>
                  <Button icon={CopyIcon} onClick={handleCopyUrl}>
                    复制
                  </Button>
                </InlineStack>
                {expiresAt && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    过期时间: {expiresAt.toLocaleString("zh-CN")}
                  </Text>
                )}
              </BlockStack>
            </Box>

            <Button onClick={handleGenerateShare} variant="secondary">
              重新生成链接
            </Button>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

