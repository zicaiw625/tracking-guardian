/**
 * Shop Repository
 *
 * Database operations for Shop model.
 */

import { type Shop, type Prisma, type PixelConfig } from "@prisma/client";
import { BaseRepository, type TransactionClient } from "./base-repository";
import { ok, err, type AsyncResult } from "../../types/result";
import { AppError, ErrorCode } from "../../utils/errors";

// =============================================================================
// Types
// =============================================================================

export type ShopCreate = Prisma.ShopCreateInput;
export type ShopUpdate = Prisma.ShopUpdateInput;

export interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export interface ShopWithRelations extends Shop {
  pixelConfigs?: PixelConfig[];
  alertConfigs?: unknown[];
}

// =============================================================================
// Shop Repository
// =============================================================================

export class ShopRepository extends BaseRepository<Shop, ShopCreate, ShopUpdate> {
  constructor() {
    super("Shop");
  }

  protected getDelegate(client?: TransactionClient) {
    const db = client || this.db;
    return db.shop;
  }

  // ===========================================================================
  // Shop-Specific Queries
  // ===========================================================================

  /**
   * Find shop by domain
   */
  async findByDomain(
    shopDomain: string
  ): AsyncResult<Shop | null, AppError> {
    return this.findFirst({ shopDomain });
  }

  /**
   * Find shop by domain, throw if not found
   */
  async findByDomainOrFail(
    shopDomain: string
  ): AsyncResult<Shop, AppError> {
    const result = await this.findByDomain(shopDomain);
    if (!result.ok) return result;
    if (!result.value) {
      return err(
        new AppError(
          ErrorCode.NOT_FOUND_SHOP,
          `Shop ${shopDomain} not found`,
          false,
          { shopDomain }
        )
      );
    }
    return ok(result.value);
  }

  /**
   * Find shop with pixel configs
   */
  async findByDomainWithPixelConfigs(
    shopDomain: string
  ): AsyncResult<ShopWithPixelConfigs | null, AppError> {
    try {
      const result = await this.db.shop.findUnique({
        where: { shopDomain },
        include: {
          pixelConfigs: {
            where: { isActive: true },
          },
        },
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findByDomainWithPixelConfigs"));
    }
  }

  /**
   * Find shop with all active configurations
   */
  async findByDomainWithConfig(
    shopDomain: string
  ): AsyncResult<ShopWithRelations | null, AppError> {
    try {
      const result = await this.db.shop.findUnique({
        where: { shopDomain },
        include: {
          pixelConfigs: {
            where: { isActive: true },
            orderBy: { platform: "asc" },
          },
          alertConfigs: {
            where: { isEnabled: true },
          },
        },
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findByDomainWithConfig"));
    }
  }

  /**
   * Upsert shop (create or update by domain)
   */
  async upsertByDomain(
    shopDomain: string,
    createData: Omit<ShopCreate, "shopDomain">,
    updateData: ShopUpdate
  ): AsyncResult<Shop, AppError> {
    try {
      const result = await this.db.shop.upsert({
        where: { shopDomain },
        create: { shopDomain, ...createData },
        update: updateData,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "upsertByDomain"));
    }
  }

  /**
   * Update shop settings
   */
  async updateSettings(
    shopDomain: string,
    settings: {
      piiEnabled?: boolean;
      consentStrategy?: string;
      dataRetentionDays?: number;
      storefrontDomains?: string[];
    }
  ): AsyncResult<Shop, AppError> {
    try {
      const result = await this.db.shop.update({
        where: { shopDomain },
        data: settings,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "updateSettings"));
    }
  }

  /**
   * Update shop plan
   */
  async updatePlan(
    shopDomain: string,
    plan: string,
    monthlyOrderLimit: number
  ): AsyncResult<Shop, AppError> {
    try {
      const result = await this.db.shop.update({
        where: { shopDomain },
        data: { plan, monthlyOrderLimit },
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "updatePlan"));
    }
  }

  /**
   * Set shop as inactive (uninstalled)
   */
  async setInactive(shopDomain: string): AsyncResult<Shop, AppError> {
    try {
      const result = await this.db.shop.update({
        where: { shopDomain },
        data: { isActive: false },
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "setInactive"));
    }
  }

  /**
   * Find shops with active webhook configurations
   */
  async findActiveShopsWithWebhooks(): AsyncResult<Shop[], AppError> {
    return this.findMany({
      isActive: true,
    });
  }

  /**
   * Find shops needing reconciliation
   */
  async findShopsForReconciliation(
    minConfiguredPlatforms: number = 1
  ): AsyncResult<ShopWithPixelConfigs[], AppError> {
    try {
      const result = await this.db.shop.findMany({
        where: {
          isActive: true,
          pixelConfigs: {
            some: {
              isActive: true,
              serverSideEnabled: true,
            },
          },
        },
        include: {
          pixelConfigs: {
            where: {
              isActive: true,
              serverSideEnabled: true,
            },
          },
        },
      });

      // Filter by minimum configured platforms
      const filtered = result.filter(
        (shop) => shop.pixelConfigs.length >= minConfiguredPlatforms
      );

      return ok(filtered);
    } catch (error) {
      return err(this.handleError(error, "findShopsForReconciliation"));
    }
  }

  /**
   * Get shop statistics
   */
  async getStatistics(shopDomain: string): AsyncResult<{
    totalConversions: number;
    activePixelConfigs: number;
    recentJobsCount: number;
  }, AppError> {
    try {
      const shop = await this.db.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });

      if (!shop) {
        return err(
          new AppError(ErrorCode.NOT_FOUND_SHOP, `Shop ${shopDomain} not found`)
        );
      }

      const [totalConversions, activePixelConfigs, recentJobsCount] = await Promise.all([
        this.db.conversionLog.count({
          where: { shopId: shop.id, status: "sent" },
        }),
        this.db.pixelConfig.count({
          where: { shopId: shop.id, isActive: true },
        }),
        this.db.conversionJob.count({
          where: {
            shopId: shop.id,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

      return ok({
        totalConversions,
        activePixelConfigs,
        recentJobsCount,
      });
    } catch (error) {
      return err(this.handleError(error, "getStatistics"));
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let shopRepositoryInstance: ShopRepository | null = null;

export function getShopRepository(): ShopRepository {
  if (!shopRepositoryInstance) {
    shopRepositoryInstance = new ShopRepository();
  }
  return shopRepositoryInstance;
}

