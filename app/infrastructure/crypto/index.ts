

export {
  getEncryptionKey,
  resetEncryptionKeyCache,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  hashValue,
  hashValueSync,
  // P0-3: v1.0 版本不包含任何 PCD/PII 处理，normalizePhone/normalizeEmail 在 v1.0 中不使用
  normalizePhone,
  normalizeEmail,
  generateEventId,
  normalizeOrderId,
  generateMatchKey,
  matchKeysEqual,
  generateDeduplicationFingerprint,
  validateEncryptionConfig,
  type MatchKeyInput,
  type MatchKeyResult,
} from "../../utils/crypto.server";

export {
  encryptAccessToken,
  decryptAccessToken,
  encryptIngestionSecret,
  decryptIngestionSecret,
  isTokenEncrypted,
} from "../../utils/token-encryption";

export {
  checkSecurityViolations,
  enforceSecurityChecks,
  validateSecrets,
  getSecretsSummary,
  ensureSecretsValid,
  getRequiredSecret,
  getOptionalSecret,
} from "../../utils/secrets";

