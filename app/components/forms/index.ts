/**
 * Forms Components Index
 *
 * Re-exports all form components for convenient imports.
 */

export {
  FormSection,
  type FormSectionProps,
} from "./FormSection";

export {
  PlatformCredentialsForm,
  getEmptyCredentials,
  areCredentialsComplete,
  type PlatformType,
  type MetaCredentials,
  type GoogleCredentials,
  type TikTokCredentials,
  type PlatformCredentials,
  type PlatformCredentialsFormProps,
} from "./PlatformCredentialsForm";

export {
  AlertConfigForm,
  getDefaultAlertConfig,
  isAlertConfigValid,
  getChannelSettings,
  type AlertChannel,
  type AlertConfig,
  type AlertConfigFormProps,
} from "./AlertConfigForm";

