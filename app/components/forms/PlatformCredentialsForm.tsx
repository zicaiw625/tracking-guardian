import { BlockStack, TextField } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  return (
    <BlockStack gap="300">
      <TextField
        label={t("Forms.Credentials.Meta.PixelId.Label")}
        value={values.pixelId}
        onChange={(v) => onChange({ ...values, pixelId: v })}
        autoComplete="off"
        placeholder={t("Forms.Credentials.Meta.PixelId.Placeholder")}
        error={errors?.pixelId}
        disabled={disabled}
      />
      <TextField
        label={t("Forms.Credentials.Meta.AccessToken.Label")}
        type="password"
        value={values.accessToken}
        onChange={(v) => onChange({ ...values, accessToken: v })}
        autoComplete="off"
        helpText={t("Forms.Credentials.Meta.AccessToken.HelpText")}
        error={errors?.accessToken}
        disabled={disabled}
      />
      <TextField
        label={t("Forms.Credentials.Meta.TestEventCode.Label")}
        value={values.testEventCode || ""}
        onChange={(v) => onChange({ ...values, testEventCode: v || undefined })}
        autoComplete="off"
        helpText={t("Forms.Credentials.Meta.TestEventCode.HelpText")}
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
  const { t } = useTranslation();
  const measurementIdError =
    errors?.measurementId ||
    (values.measurementId && !values.measurementId.match(/^G-[A-Z0-9]+$/i)
      ? t("Forms.Credentials.Google.MeasurementId.Error")
      : undefined);
  return (
    <BlockStack gap="300">
      <TextField
        label={t("Forms.Credentials.Google.MeasurementId.Label")}
        value={values.measurementId}
        onChange={(v) => onChange({ ...values, measurementId: v })}
        autoComplete="off"
        placeholder={t("Forms.Credentials.Google.MeasurementId.Placeholder")}
        helpText={t("Forms.Credentials.Google.MeasurementId.HelpText")}
        error={measurementIdError}
        disabled={disabled}
      />
      <TextField
        label={t("Forms.Credentials.Google.ApiSecret.Label")}
        type="password"
        value={values.apiSecret}
        onChange={(v) => onChange({ ...values, apiSecret: v })}
        autoComplete="off"
        helpText={t("Forms.Credentials.Google.ApiSecret.HelpText")}
        error={errors?.apiSecret}
        disabled={disabled}
      />
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
  const { t } = useTranslation();
  return (
    <BlockStack gap="300">
      <TextField
        label={t("Forms.Credentials.TikTok.PixelId.Label")}
        value={values.pixelId}
        onChange={(v) => onChange({ ...values, pixelId: v })}
        autoComplete="off"
        placeholder={t("Forms.Credentials.TikTok.PixelId.Placeholder")}
        error={errors?.pixelId}
        disabled={disabled}
      />
      <TextField
        label={t("Forms.Credentials.TikTok.AccessToken.Label")}
        type="password"
        value={values.accessToken}
        onChange={(v) => onChange({ ...values, accessToken: v })}
        autoComplete="off"
        helpText={t("Forms.Credentials.TikTok.AccessToken.HelpText")}
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
