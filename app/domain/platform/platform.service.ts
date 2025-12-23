/**
 * Platform Service Interface
 *
 * Defines the contract for platform CAPI services.
 */

import type { AsyncResult } from "../../types/result";
import type { AppError } from "../../utils/errors";
import type {
  Platform,
  PlatformCredentials,
  ConversionData,
  PlatformSendResult,
  PlatformError,
} from "./platform.types";

// =============================================================================
// Credentials Validation
// =============================================================================

/**
 * Result of credentials validation
 */
export interface CredentialsValidationResult {
  valid: boolean;
  errors: string[];
}

// =============================================================================
// Platform Service Interface
// =============================================================================

/**
 * Platform service interface
 *
 * All platform implementations must conform to this interface.
 */
export interface IPlatformService {
  /**
   * Platform identifier
   */
  readonly platform: Platform;

  /**
   * Human-readable platform name
   */
  readonly displayName: string;

  /**
   * Send a conversion event to the platform
   *
   * @param credentials Platform credentials
   * @param data Conversion data
   * @param eventId Deduplication event ID
   */
  sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult>;

  /**
   * Validate credentials format
   *
   * @param credentials Credentials to validate
   */
  validateCredentials(credentials: unknown): CredentialsValidationResult;

  /**
   * Parse platform-specific error from response
   *
   * @param error Error or response to parse
   */
  parseError(error: unknown): PlatformError;

  /**
   * Build the platform-specific payload
   *
   * @param data Conversion data
   * @param eventId Deduplication event ID
   */
  buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;
}

// =============================================================================
// Platform Registry Interface
// =============================================================================

/**
 * Platform registry for managing platform services
 */
export interface IPlatformRegistry {
  /**
   * Register a platform service
   */
  register(platform: Platform, service: IPlatformService): void;

  /**
   * Get a platform service
   */
  get(platform: Platform): IPlatformService | undefined;

  /**
   * Check if a platform is registered
   */
  has(platform: Platform): boolean;

  /**
   * Get all registered platforms
   */
  getPlatforms(): Platform[];

  /**
   * Get all platform services
   */
  getAll(): Map<Platform, IPlatformService>;
}

// =============================================================================
// Platform Orchestrator Interface
// =============================================================================

/**
 * Result of sending to multiple platforms
 */
export interface MultiPlatformSendResult {
  results: Record<Platform, PlatformSendResult>;
  totalSucceeded: number;
  totalFailed: number;
  duration: number;
}

/**
 * Platform orchestrator for coordinating sends to multiple platforms
 */
export interface IPlatformOrchestrator {
  /**
   * Send conversion to a single platform
   */
  sendToOne(
    platform: Platform,
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): AsyncResult<PlatformSendResult, AppError>;

  /**
   * Send conversion to multiple platforms in parallel
   */
  sendToMany(
    platforms: Array<{
      platform: Platform;
      credentials: PlatformCredentials;
    }>,
    data: ConversionData,
    eventId: string
  ): AsyncResult<MultiPlatformSendResult, AppError>;
}

// =============================================================================
// Event Types for Platform Operations
// =============================================================================

/**
 * Base platform event
 */
export interface PlatformEvent {
  readonly platform: Platform;
  readonly shopDomain: string;
  readonly orderId: string;
  readonly eventId: string;
  readonly occurredAt: Date;
}

/**
 * Conversion sent event
 */
export interface ConversionSentEvent extends PlatformEvent {
  readonly type: "conversion_sent";
  readonly duration: number;
  readonly response?: Record<string, unknown>;
}

/**
 * Conversion failed event
 */
export interface ConversionFailedEvent extends PlatformEvent {
  readonly type: "conversion_failed";
  readonly error: PlatformError;
  readonly willRetry: boolean;
}

/**
 * Rate limit hit event
 */
export interface RateLimitEvent extends PlatformEvent {
  readonly type: "rate_limit_hit";
  readonly retryAfter?: number;
}

/**
 * All platform events
 */
export type PlatformDomainEvent =
  | ConversionSentEvent
  | ConversionFailedEvent
  | RateLimitEvent;

