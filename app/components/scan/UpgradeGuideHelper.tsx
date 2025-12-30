
import { useState, useCallback } from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Box,
  List,
  Icon,
  FileUpload,
} from "@shopify/polaris";
import { UploadIcon, InfoIcon } from "~/components/icons";
import { useToastContext } from "~/components/ui";

interface UpgradeGuideHelperProps {
  onAssetsCreated?: (count: number) => void;
}

export function UpgradeGuideHelper({ onAssetsCreated }: UpgradeGuideHelperProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const { showSuccess, showError } = useToastContext();

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file) return;

    // 验证文件类型
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "text/plain"];
    if (!validTypes.includes(file.type)) {
      showError("不支持的文件类型。请上传 PNG、JPEG 或文本文件。");
      return;
    }

    // 验证文件大小（最大 5MB）
    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showError("文件过大。请上传小于 5MB 的文件。");
      return;
    }

    setUploadedFile(file);
    setUploading(true);

    try {
      // 如果是文本文件，直接解析
      if (file.type === "text/plain") {
        const text = await file.text();
        await parseTextList(text);
      } else {
        // 图片文件，需要 OCR（这里先提示用户手动输入）
        showError("图片 OCR 功能开发中。请将清单内容复制为文本文件上传，或手动粘贴到脚本编辑器。");
        setUploading(false);
        return;
      }
    } catch (error) {
      console.error("File upload error:", error);
      showError("文件处理失败，请稍后重试。");
      setUploading(false);
    }
  }, [showSuccess, showError, onAssetsCreated]);

  const parseTextList = async (text: string) => {
    try {
      // 解析 Shopify 升级向导报告格式
      // 常见格式：
      // 1. 平台列表（每行一个）
      // 2. JSON 格式
      // 3. 标记列表（- 或 * 开头）

      const lines = text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
      const platforms: string[] = [];
      const items: Array<{ name: string; type: string }> = [];

      // 尝试解析 JSON
      try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          json.forEach((item: unknown) => {
            if (typeof item === "string") {
              platforms.push(item);
            } else if (typeof item === "object" && item !== null) {
              const obj = item as Record<string, unknown>;
              if (obj.name && typeof obj.name === "string") {
                items.push({
                  name: obj.name,
                  type: (obj.type as string) || "other",
                });
              }
            }
          });
        }
      } catch {
        // 不是 JSON，尝试解析文本列表
        lines.forEach(line => {
          // 移除列表标记
          const cleaned = line.replace(/^[-*•]\s*/, "").trim();
          
          // 检测平台名称
          const platformPatterns = [
            { pattern: /google|ga4|analytics/i, name: "google" },
            { pattern: /meta|facebook|fb/i, name: "meta" },
            { pattern: /tiktok|tt/i, name: "tiktok" },
            { pattern: /pinterest|pin/i, name: "pinterest" },
            { pattern: /snapchat|snap/i, name: "snapchat" },
            { pattern: /bing|microsoft/i, name: "bing" },
          ];

          let matched = false;
          for (const { pattern, name } of platformPatterns) {
            if (pattern.test(cleaned)) {
              platforms.push(name);
              matched = true;
              break;
            }
          }

          if (!matched && cleaned.length > 0) {
            items.push({
              name: cleaned,
              type: "other",
            });
          }
        });
      }

      // 发送到后端创建 AuditAsset
      if (platforms.length > 0 || items.length > 0) {
        const response = await fetch("/api/audit-assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_from_list",
            platforms,
            items,
          }),
        });

        if (!response.ok) {
          throw new Error("创建资产失败");
        }

        const result = await response.json();
        const createdCount = result.created || 0;

        showSuccess(`成功识别 ${platforms.length} 个平台，创建 ${createdCount} 个迁移项`);
        onAssetsCreated?.(createdCount);
      } else {
        showError("未能识别到有效的平台或脚本项。请检查文件格式。");
      }
    } catch (error) {
      console.error("Parse error:", error);
      showError("解析文件失败，请稍后重试。");
    } finally {
      setUploading(false);
      setUploadedFile(null);
    }
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Shopify 升级向导清单导入
          </Text>
          <Icon source={InfoIcon} tone="info" />
        </InlineStack>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              如何获取升级向导清单？
            </Text>
            <List type="number">
              <List.Item>
                <Text as="span" variant="bodySm">
                  前往 Shopify 后台 → 设置 → 结账
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  查找「Upgrade to Checkout Extensibility」横幅
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  点击「查看需要迁移的脚本」或类似链接
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  复制清单内容并保存为文本文件，或直接粘贴到下方
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>

        <Box>
          <FileUpload
            accept=".txt,.text,.json,image/png,image/jpeg,image/jpg"
            label="上传清单文件"
            onDrop={(files) => {
              if (files.length > 0) {
                handleFileUpload(files[0]);
              }
            }}
            onDropAccepted={(files) => {
              if (files.length > 0) {
                handleFileUpload(files[0]);
              }
            }}
            onDropRejected={() => {
              showError("文件类型不支持或文件过大");
            }}
            disabled={uploading}
          />
        </Box>

        {uploadedFile && (
          <Banner tone="success">
            <Text as="p" variant="bodySm">
              已上传: {uploadedFile.name} ({Math.round(uploadedFile.size / 1024)} KB)
            </Text>
          </Banner>
        )}

        <Banner>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              支持的格式：
            </Text>
            <List type="bullet">
              <List.Item>
                <Text as="span" variant="bodySm">
                  文本文件（.txt）：每行一个平台或脚本名称
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  JSON 文件：包含平台列表的 JSON 数组
                </Text>
              </List.Item>
              <List.Item>
                <Text as="span" variant="bodySm">
                  图片文件（PNG/JPEG）：OCR 功能开发中
                </Text>
              </List.Item>
            </List>
          </BlockStack>
        </Banner>
      </BlockStack>
    </Card>
  );
}

