/**
 * Platform Service Registry
 *
 * Provides a registry pattern for platform services, replacing the simple factory.
 * Benefits:
 * - Dynamic registration of platforms
 * - Better testability (can mock/swap implementations)
 * - Support for platform discovery
 * - Centralized platform configuration
 */

import type {
  IPlatformService,
  IPlatformRegistry,
  IPlatformOrchestrator,
  MultiPlatformSendResult,
  Platform,
  PlatformCredentials,
  ConversionData,
  PlatformSendResult,
  PlatformError,
} from "../../domain/platform";
import { ok, err, type AsyncResult } from "../../types/result";
import { AppError, ErrorCode } from "../../utils/errors";
import { logger, createTimer } from "../../utils/logger.server";

// =============================================================================
// Platform Registry Implementation
// =============================================================================

/**
 * Platform registry implementation
 *
 * Manages registration and lookup of platform services.
 */
class PlatformRegistry implements IPlatformRegistry {
  private readonly services = new Map<Platform, IPlatformService>();

  /**
   * Register a platform service
   */
  register(platform: Platform, service: IPlatformService): void {
    if (this.services.has(platform)) {
      logger.warn(`Platform ${platform} is being re-registered`);
    }
    this.services.set(platform, service);
    logger.debug(`Registered platform service: ${platform}`);
  }

  /**
   * Get a platform service
   */
  get(platform: Platform): IPlatformService | undefined {
    return this.services.get(platform);
  }

  /**
   * Check if a platform is registered
   */
  has(platform: Platform): boolean {
    return this.services.has(platform);
  }

  /**
   * Get all registered platforms
   */
  getPlatforms(): Platform[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get all platform services
   */
  getAll(): Map<Platform, IPlatformService> {
    return new Map(this.services);
  }

  /**
   * Unregister a platform (mainly for testing)
   */
  unregister(platform: Platform): boolean {
    return this.services.delete(platform);
  }

  /**
   * Clear all registrations (mainly for testing)
   */
  clear(): void {
    this.services.clear();
  }
}

// =============================================================================
// Platform Orchestrator Implementation
// =============================================================================

/**
 * Platform orchestrator implementation
 *
 * Coordinates sending conversions to one or more platforms.
 */
class PlatformOrchestrator implements IPlatformOrchestrator {
  constructor(private readonly registry: IPlatformRegistry) {}

  /**
   * Send conversion to a single platform
   */
  async sendToOne(
    platform: Platform,
    credentials: PlatformCredentials,
    data: ConversionData,
    eventId: string
  ): AsyncResult<PlatformSendResult, AppError> {
    const service = this.registry.get(platform);

    if (!service) {
      return err(
        new AppError(
          ErrorCode.PLATFORM_INVALID_CONFIG,
          `Platform ${platform} is not registered`,
          false,
          { platform }
        )
      );
    }

    try {
      const timer = createTimer();
      const result = await service.sendConversion(credentials, data, eventId);

      return ok({
        ...result,
        duration: timer.elapsed(),
      });
    } catch (error) {
      const platformError: PlatformError = {
        type: "unknown",
        message: error instanceof Error ? error.message : String(error),
        isRetryable: true,
      };

      return ok({
        success: false,
        error: platformError,
      });
    }
  }

  /**
   * Send conversion to multiple platforms in parallel
   */
  async sendToMany(
    platforms: Array<{
      platform: Platform;
      credentials: PlatformCredentials;
    }>,
    data: ConversionData,
    eventId: string
  ): AsyncResult<MultiPlatformSendResult, AppError> {
    const overallTimer = createTimer();
    const results: Record<Platform, PlatformSendResult> = {} as Record<Platform, PlatformSendResult>;

    // Send to all platforms in parallel
    const promises = platforms.map(async ({ platform, credentials }) => {
      const result = await this.sendToOne(platform, credentials, data, eventId);

      if (result.ok) {
        results[platform] = result.value;
      } else {
        results[platform] = {
          success: false,
          error: {
            type: "unknown",
            message: result.error.message,
            isRetryable: true,
          },
        };
      }
    });

    await Promise.all(promises);

    // Calculate summary
    let totalSucceeded = 0;
    let totalFailed = 0;

    for (const result of Object.values(results)) {
      if (result.success) {
        totalSucceeded++;
      } else {
        totalFailed++;
      }
    }

    return ok({
      results,
      totalSucceeded,
      totalFailed,
      duration: overallTimer.elapsed(),
    });
  }
}

// =============================================================================
// Global Registry Instance
// =============================================================================

/**
 * Global platform registry instance
 */
export const platformRegistry = new PlatformRegistry();

/**
 * Global platform orchestrator instance
 */
export const platformOrchestrator = new PlatformOrchestrator(platformRegistry);

// =============================================================================
// Registry Initialization
// =============================================================================

/**
 * Initialize platform registry with default services
 *
 * Call this once during app startup.
 */
export function initializePlatformRegistry(
  services?: Partial<Record<Platform, IPlatformService>>
): void {
  // Import services lazily to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { googleService } = require("./google.service");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { metaService } = require("./meta.service");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tiktokService } = require("./tiktok.service");

  // Register default services
  platformRegistry.register("google", services?.google ?? googleService);
  platformRegistry.register("meta", services?.meta ?? metaService);
  platformRegistry.register("tiktok", services?.tiktok ?? tiktokService);

  logger.info("Platform registry initialized", {
    platforms: platformRegistry.getPlatforms(),
  });
}

/**
 * Check if registry is initialized
 */
export function isRegistryInitialized(): boolean {
  return platformRegistry.getPlatforms().length > 0;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get a platform service from the global registry
 */
export function getPlatformService(platform: Platform): IPlatformService | undefined {
  return platformRegistry.get(platform);
}

/**
 * Get a platform service, throwing if not found
 */
export function requirePlatformService(platform: Platform): IPlatformService {
  const service = platformRegistry.get(platform);
  if (!service) {
    throw new Error(`Platform ${platform} is not registered`);
  }
  return service;
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(platform: string): boolean {
  return platformRegistry.has(platform as Platform);
}

/**
 * Get all supported platforms
 */
export function getSupportedPlatforms(): Platform[] {
  return platformRegistry.getPlatforms();
}

/**
 * Send conversion to a platform using the global orchestrator
 */
export async function sendConversion(
  platform: Platform,
  credentials: PlatformCredentials,
  data: ConversionData,
  eventId: string
): AsyncResult<PlatformSendResult, AppError> {
  return platformOrchestrator.sendToOne(platform, credentials, data, eventId);
}

/**
 * Send conversion to multiple platforms using the global orchestrator
 */
export async function sendToMultiplePlatforms(
  platforms: Array<{
    platform: Platform;
    credentials: PlatformCredentials;
  }>,
  data: ConversionData,
  eventId: string
): AsyncResult<MultiPlatformSendResult, AppError> {
  return platformOrchestrator.sendToMany(platforms, data, eventId);
}

// =============================================================================
// Type Exports
// =============================================================================

export type {
  IPlatformService,
  IPlatformRegistry,
  IPlatformOrchestrator,
  MultiPlatformSendResult,
};

export { PlatformRegistry, PlatformOrchestrator };

