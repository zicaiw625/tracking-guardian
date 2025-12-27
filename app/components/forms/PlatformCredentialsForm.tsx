

import { BlockStack, TextField, Banner, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

export type PlatformType = "meta" | "google" | "tiktok";

export interface MetaCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

export interface GoogleCredentials {
  measurementId: string;
  apiSecret: string;
}

export interface TikTokCredentials {
  pixelId: string;
  accessToken: string;
}

export type PlatformCredentials =
  | MetaCredentials
  | GoogleCredentials
  | TikTokCredentials;

export interface PlatformCredentialsFormProps {

  platform: PlatformType;

  values: PlatformCredentials;

  onChange: (values: PlatformCredentials) => void;

  errors?: Record<string, string>;

  disabled?: boolean;
}

interface MetaFormProps {
  values: MetaCredentials;
  onChange: (values: MetaCredentials) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

function MetaForm({ values, onChange, errors, disabled }: MetaFormProps) {
  return (
    <BlockStack gap="300">
      <TextField
        label="Pixel ID"
        value={values.pixelId}
        onChange={(v) => onChange({ ...values, pixelId: v })}
        autoComplete="off"
        placeholder="1234567890123456"
        error={errors?.pixelId}
        disabled={disabled}
      />
      <TextField
        label="Access Token"
        type="password"
        value={values.accessToken}
        onChange={(v) => onChange({ ...values, accessToken: v })}
        autoComplete="off"
        helpText="在 Meta Events Manager 中生成系统用户访问令牌"
        error={errors?.accessToken}
        disabled={disabled}
      />
      <TextField
        label="Test Event Code (可选)"
        value={values.testEventCode || ""}
        onChange={(v) => onChange({ ...values, testEventCode: v || undefined })}
        autoComplete="off"
        helpText="用于测试模式，生产环境请留空"
        error={errors?.testEventCode}
        disabled={disabled}
      />
    </BlockStack>
  );
}

interface GoogleFormProps {
  values: GoogleCredentials;
  onChange: (values: GoogleCredentials) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

function GoogleForm({ values, onChange, errors, disabled }: GoogleFormProps) {
  const measurementIdError =
    errors?.measurementId ||
    (values.measurementId && !values.measurementId.match(/^G-[A-Z0-9]+$/i)
      ? "格式应为 G-XXXXXXXXXX"
      : undefined);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <p>
          <strong>GA4 Measurement Protocol</strong> 是推荐的服务端追踪方式。
          Google Ads 可以从 GA4 导入转化数据进行归因优化。
        </p>
      </Banner>
      <TextField
        label="Measurement ID"
        value={values.measurementId}
        onChange={(v) => onChange({ ...values, measurementId: v })}
        autoComplete="off"
        placeholder="G-XXXXXXXXXX"
        helpText="GA4 媒体资源的 Measurement ID。在 GA4 管理后台 > 数据流中找到"
        error={measurementIdError}
        disabled={disabled}
      />
      <TextField
        label="API Secret"
        type="password"
        value={values.apiSecret}
        onChange={(v) => onChange({ ...values, apiSecret: v })}
        autoComplete="off"
        helpText="在 GA4 > 数据流 > Measurement Protocol API 密钥中创建"
        error={errors?.apiSecret}
        disabled={disabled}
      />
      <Text as="p" variant="bodySm" tone="subdued">
        💡 提示：如需在 Google Ads 中使用转化数据，请在 Google Ads
        中设置「从 GA4 导入转化」。
      </Text>
    </BlockStack>
  );
}

interface TikTokFormProps {
  values: TikTokCredentials;
  onChange: (values: TikTokCredentials) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

function TikTokForm({ values, onChange, errors, disabled }: TikTokFormProps) {
  return (
    <BlockStack gap="300">
      <TextField
        label="Pixel ID"
        value={values.pixelId}
        onChange={(v) => onChange({ ...values, pixelId: v })}
        autoComplete="off"
        placeholder="C1234567890123456789"
        error={errors?.pixelId}
        disabled={disabled}
      />
      <TextField
        label="Access Token"
        type="password"
        value={values.accessToken}
        onChange={(v) => onChange({ ...values, accessToken: v })}
        autoComplete="off"
        helpText="在 TikTok Events Manager 中生成"
        error={errors?.accessToken}
        disabled={disabled}
      />
    </BlockStack>
  );
}

export function PlatformCredentialsForm({
  platform,
  values,
  onChange,
  errors,
  disabled,
}: PlatformCredentialsFormProps) {
  switch (platform) {
    case "meta":
      return (
        <MetaForm
          values={values as MetaCredentials}
          onChange={onChange}
          errors={errors}
          disabled={disabled}
        />
      );
    case "google":
      return (
        <GoogleForm
          values={values as GoogleCredentials}
          onChange={onChange}
          errors={errors}
          disabled={disabled}
        />
      );
    case "tiktok":
      return (
        <TikTokForm
          values={values as TikTokCredentials}
          onChange={onChange}
          errors={errors}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
}

export function getEmptyCredentials(platform: PlatformType): PlatformCredentials {
  switch (platform) {
    case "meta":
      return { pixelId: "", accessToken: "", testEventCode: "" };
    case "google":
      return { measurementId: "", apiSecret: "" };
    case "tiktok":
      return { pixelId: "", accessToken: "" };
  }
}

export function areCredentialsComplete(
  platform: PlatformType,
  credentials: PlatformCredentials
): boolean {
  switch (platform) {
    case "meta": {
      const meta = credentials as MetaCredentials;
      return Boolean(meta.pixelId && meta.accessToken);
    }
    case "google": {
      const google = credentials as GoogleCredentials;
      return Boolean(google.measurementId && google.apiSecret);
    }
    case "tiktok": {
      const tiktok = credentials as TikTokCredentials;
      return Boolean(tiktok.pixelId && tiktok.accessToken);
    }
  }
}

export default PlatformCredentialsForm;

