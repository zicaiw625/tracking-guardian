

import type { AsyncResult } from "../../types/result";
import type { AppError } from "../../utils/errors";
import type {
  Platform,
  PlatformCredentials,
  ConversionData,
  PlatformSendResult,
  PlatformError,
} from "./platform.types";

export interface CredentialsValidationResult {
  valid: boolean;
  errors: string[];
}

export interface IPlatformService {

  readonly platform: Platform;

  readonly displayName: string;

  sendConversion(
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): Promise<PlatformSendResult>;

  validateCredentials(credentials: unknown): CredentialsValidationResult;

  parseError(error: unknown): PlatformError;

  buildPayload(
    data: ConversionData,
    eventId: string
  ): Promise<Record<string, unknown>>;
}

export interface IPlatformRegistry {

  register(platform: Platform, service: IPlatformService): void;

  get(platform: Platform): IPlatformService | undefined;

  has(platform: Platform): boolean;

  getPlatforms(): Platform[];

  getAll(): Map<Platform, IPlatformService>;
}

export interface MultiPlatformSendResult {
  results: Record<Platform, PlatformSendResult>;
  totalSucceeded: number;
  totalFailed: number;
  duration: number;
}

export interface IPlatformOrchestrator {

  sendToOne(
    platform: Platform,
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): AsyncResult<PlatformSendResult, AppError>;

  sendToMany(
    platforms: Array<{
      platform: Platform;
      credentials: PlatformCredentials;
    }>,
    data: ConversionData,
    eventId: string
  ): AsyncResult<MultiPlatformSendResult, AppError>;
}

export interface PlatformEvent {
  readonly platform: Platform;
  readonly shopDomain: string;
  readonly orderId: string;
  readonly eventId: string;
  readonly occurredAt: Date;
}

export interface ConversionSentEvent extends PlatformEvent {
  readonly type: "conversion_sent";
  readonly duration: number;
  readonly response?: Record<string, unknown>;
}

export interface ConversionFailedEvent extends PlatformEvent {
  readonly type: "conversion_failed";
  readonly error: PlatformError;
  readonly willRetry: boolean;
}

export interface RateLimitEvent extends PlatformEvent {
  readonly type: "rate_limit_hit";
  readonly retryAfter?: number;
}

export type PlatformDomainEvent =
  | ConversionSentEvent
  | ConversionFailedEvent
  | RateLimitEvent;

