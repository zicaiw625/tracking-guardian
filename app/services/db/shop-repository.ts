import { type Shop, type Prisma, type PixelConfig } from "@prisma/client";
import { BaseRepository, type TransactionClient, type PrismaDelegate } from "./base-repository";
import { ok, err, type AsyncResult } from "../../types/result";
import { AppError, ErrorCode } from "../../utils/errors";

export type ShopCreate = Prisma.ShopCreateInput;
export type ShopUpdate = Prisma.ShopUpdateInput;

export interface ShopWithPixelConfigs extends Shop {
  pixelConfigs: PixelConfig[];
}

export interface ShopWithRelations extends Shop {
  pixelConfigs?: PixelConfig[];
  alertConfigs?: unknown[];
}

export class ShopRepository extends BaseRepository<Shop, ShopCreate, ShopUpdate> {
  constructor() {
    super("Shop");
  }

  protected getDelegate(client?: TransactionClient): PrismaDelegate<Shop> {
    const db = client || this.db;
    return db.shop as unknown as PrismaDelegate<Shop>;
  }

  async findByDomain(
    shopDomain: string
  ): AsyncResult<Shop | null, AppError> {
    return this.findFirst({ shopDomain });
  }

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
          AlertConfig: {
            where: { isEnabled: true },
          },
        },
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findByDomainWithConfig"));
    }
  }

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

  async updateSettings(
    shopDomain: string,
    settings: {

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

  async findActiveShopsWithWebhooks(): AsyncResult<Shop[], AppError> {
    return this.findMany({
      isActive: true,
    });
  }

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

      const filtered = result.filter(
        (shop) => shop.pixelConfigs.length >= minConfiguredPlatforms
      );

      return ok(filtered);
    } catch (error) {
      return err(this.handleError(error, "findShopsForReconciliation"));
    }
  }

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

let shopRepositoryInstance: ShopRepository | null = null;

export function getShopRepository(): ShopRepository {
  if (!shopRepositoryInstance) {
    shopRepositoryInstance = new ShopRepository();
  }
  return shopRepositoryInstance;
}
