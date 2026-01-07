

export {
  getEncryptionKey,
  resetEncryptionKeyCache,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  hashValue,
  hashValueSync,

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

