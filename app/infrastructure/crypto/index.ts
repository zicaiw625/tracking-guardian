/**
 * Cryptography Infrastructure
 *
 * P2-1: Centralized cryptographic operations:
 * - Encryption/decryption
 * - Signing and verification
 * - Key management
 * - Token handling
 */

// Core encryption
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

// Token encryption
export {
  encryptAccessToken,
  decryptAccessToken,
  encryptIngestionSecret,
  decryptIngestionSecret,
  isTokenEncrypted,
} from "../../utils/token-encryption";

// Secrets management
export {
  checkSecurityViolations,
  enforceSecurityChecks,
  validateSecrets,
  getSecretsSummary,
  ensureSecretsValid,
  getRequiredSecret,
  getOptionalSecret,
} from "../../utils/secrets";

