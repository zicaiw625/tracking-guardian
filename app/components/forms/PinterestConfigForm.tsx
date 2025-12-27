/**
 * Pinterest 凭证配置表单
 * 对应设计方案 4.3 像素迁移中心 - Pinterest 支持
 */

import { useState, useCallback } from "react";
import {
  BlockStack,
  Card,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  InlineStack,
  Link,
  Divider,
  Box,
} from "@shopify/polaris";

export interface PinterestCredentialsInput {
  adAccountId: string;
  accessToken: string;
  testMode: boolean;
}

export interface PinterestConfigFormProps {
  /** 现有配置 (如果已配置) */
  config?: {
    adAccountId: string;
    hasAccessToken: boolean;
    testMode: boolean;
  };
  /** 保存回调 */
  onSave: (data: PinterestCredentialsInput) => void;
  /** 是否正在保存 */
  isLoading?: boolean;
  /** 验证状态 */
  validationStatus?: "idle" | "validating" | "valid" | "invalid";
  /** 验证错误信息 */
  validationError?: string;
  /** 触发验证 */
  onValidate?: (data: PinterestCredentialsInput) => void;
}

export function PinterestConfigForm({
  config,
  onSave,
  isLoading = false,
  validationStatus = "idle",
  validationError,
  onValidate,
}: PinterestConfigFormProps) {
  const [adAccountId, setAdAccountId] = useState(config?.adAccountId || "");
  const [accessToken, setAccessToken] = useState("");
  const [testMode, setTestMode] = useState(config?.testMode ?? true);
  const [showToken, setShowToken] = useState(false);

  // 表单验证
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    // Ad Account ID 验证
    if (!adAccountId.trim()) {
      newErrors.adAccountId = "请输入 Pinterest Ad Account ID";
    } else if (!/^\d+$/.test(adAccountId.trim())) {
      newErrors.adAccountId = "Ad Account ID 应为纯数字";
    }

    // Access Token 验证 (仅在未配置或需要更新时必填)
    if (!config?.hasAccessToken && !accessToken.trim()) {
      newErrors.accessToken = "请输入 Pinterest Access Token";
    } else if (accessToken.trim() && accessToken.trim().length < 20) {
      newErrors.accessToken = "Access Token 格式不正确";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [adAccountId, accessToken, config?.hasAccessToken]);

  const handleSave = useCallback(() => {
    if (!validateForm()) return;

    onSave({
      adAccountId: adAccountId.trim(),
      accessToken: accessToken.trim(),
      testMode,
    });
  }, [adAccountId, accessToken, testMode, validateForm, onSave]);

  const handleValidate = useCallback(() => {
    if (!validateForm()) return;
    if (!onValidate) return;

    onValidate({
      adAccountId: adAccountId.trim(),
      accessToken: accessToken.trim() || "(使用已保存的 token)",
      testMode,
    });
  }, [adAccountId, accessToken, testMode, validateForm, onValidate]);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Pinterest Conversions API
          </Text>
          {config?.hasAccessToken && (
            <Box
              background="bg-fill-success-secondary"
              padding="100"
              borderRadius="base"
            >
              <Text as="span" variant="bodySm" tone="success">
                ✓ 已配置
              </Text>
            </Box>
          )}
        </InlineStack>

        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              Pinterest Conversions API 允许您直接将转化事件发送到 Pinterest，
              不受浏览器限制影响，提高广告归因准确性。
            </Text>
            <Link
              url="https://developers.pinterest.com/docs/api/v5/#tag/conversion_events"
              external
            >
              查看 Pinterest API 文档
            </Link>
          </BlockStack>
        </Banner>

        <Divider />

        {/* Ad Account ID */}
        <TextField
          label="Ad Account ID"
          value={adAccountId}
          onChange={setAdAccountId}
          placeholder="123456789012345678"
          helpText="Pinterest 广告账户 ID，可在 Pinterest Ads Manager 中找到"
          error={errors.adAccountId}
          autoComplete="off"
        />

        {/* Access Token */}
        <TextField
          label="Access Token"
          value={accessToken}
          onChange={setAccessToken}
          type={showToken ? "text" : "password"}
          placeholder={config?.hasAccessToken ? "••••••••••••••••" : "pina_..."}
          helpText={
            config?.hasAccessToken
              ? "已保存。留空表示保留现有 Token，填写新值将覆盖。"
              : "Pinterest API Access Token，需要有 ads:write 权限"
          }
          error={errors.accessToken}
          autoComplete="off"
          connectedRight={
            <Button onClick={() => setShowToken(!showToken)} size="slim">
              {showToken ? "隐藏" : "显示"}
            </Button>
          }
        />

        {/* Test Mode */}
        <Checkbox
          label="测试模式"
          checked={testMode}
          onChange={setTestMode}
          helpText="启用后，事件将以测试模式发送，不会影响实际广告数据"
        />

        <Divider />

        {/* 获取凭证指南 */}
        <BlockStack gap="200">
          <Text as="p" variant="headingSm">
            如何获取 Pinterest API 凭证
          </Text>
          <ol style={{ margin: 0, paddingLeft: "1.5em" }}>
            <li>
              <Text as="span" variant="bodySm">
                登录{" "}
                <Link url="https://developers.pinterest.com/" external>
                  Pinterest Developers
                </Link>
              </Text>
            </li>
            <li>
              <Text as="span" variant="bodySm">
                创建或选择一个 App
              </Text>
            </li>
            <li>
              <Text as="span" variant="bodySm">
                在 App 设置中生成 Access Token（需要 <code>ads:write</code> 权限）
              </Text>
            </li>
            <li>
              <Text as="span" variant="bodySm">
                在{" "}
                <Link url="https://ads.pinterest.com/" external>
                  Pinterest Ads Manager
                </Link>{" "}
                中找到您的 Ad Account ID
              </Text>
            </li>
          </ol>
        </BlockStack>

        <Divider />

        {/* 验证状态 */}
        {validationStatus === "validating" && (
          <Banner tone="info">
            <Text as="p">正在验证凭证...</Text>
          </Banner>
        )}
        {validationStatus === "valid" && (
          <Banner tone="success">
            <Text as="p">✓ 凭证验证通过</Text>
          </Banner>
        )}
        {validationStatus === "invalid" && validationError && (
          <Banner tone="critical">
            <Text as="p">凭证验证失败: {validationError}</Text>
          </Banner>
        )}

        {/* 操作按钮 */}
        <InlineStack gap="200" align="end">
          {onValidate && (
            <Button
              onClick={handleValidate}
              disabled={isLoading || validationStatus === "validating"}
              loading={validationStatus === "validating"}
            >
              验证凭证
            </Button>
          )}
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isLoading}
            loading={isLoading}
          >
            {config?.hasAccessToken ? "更新配置" : "保存配置"}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default PinterestConfigForm;

