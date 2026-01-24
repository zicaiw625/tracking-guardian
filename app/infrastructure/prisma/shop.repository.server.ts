import type { PrismaClient } from "@prisma/client";
import { ok, err, type AsyncResult } from "../../types/result";
import { AppError, ErrorCode } from "../../utils/errors";
import type { PlanId } from "../../services/billing/plans";
import type {
  IShopRepository,
  FindShopOptions,
  ShopUpdateData,
  CreateShopData,
} from "../../domain/shop/shop.repository";
import type {
  Shop,
  ShopBasic,
  ShopWithBilling,
  ShopWithConsent,
  ShopWithSecurity,
  ConsentStrategy,
} from "../../domain/shop/shop.entity";
import { generateSimpleId } from "../../utils/helpers";
import { ensureTokenEncrypted } from "../../utils/token-encryption.server";

function mapToDomainShop(prismaShop: {
  id: string;
  shopDomain: string;
  email: string | null;
  name: string | null;
  plan: string;
  monthlyOrderLimit: number;
  isActive: boolean;
  consentStrategy: string;
  dataRetentionDays: number;
  ingestionSecret: string | null;
  previousIngestionSecret: string | null;
  previousSecretExpiry: Date | null;
  primaryDomain: string | null;
  storefrontDomains: string[];
  webPixelId: string | null;
  shopTier: string | null;
  typOspPagesEnabled: boolean | null;
  typOspLastCheckedAt: Date | null;
  typOspDetectedAt: Date | null;
  typOspStatusReason: string | null;
  installedAt: Date;
  uninstalledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Shop {
  return {
    id: prismaShop.id,
    shopDomain: prismaShop.shopDomain,
    email: prismaShop.email,
    name: prismaShop.name,
    plan: prismaShop.plan as PlanId,
    monthlyOrderLimit: prismaShop.monthlyOrderLimit,
    isActive: prismaShop.isActive,
    consentStrategy: prismaShop.consentStrategy as ConsentStrategy,
    dataRetentionDays: prismaShop.dataRetentionDays,
    ingestionSecret: prismaShop.ingestionSecret,
    previousIngestionSecret: prismaShop.previousIngestionSecret,
    previousSecretExpiry: prismaShop.previousSecretExpiry,
    primaryDomain: prismaShop.primaryDomain,
    storefrontDomains: prismaShop.storefrontDomains,
    webPixelId: prismaShop.webPixelId,
    shopTier: prismaShop.shopTier as Shop["shopTier"],
    typOspPagesEnabled: prismaShop.typOspPagesEnabled,
    typOspLastCheckedAt: prismaShop.typOspLastCheckedAt,
    typOspDetectedAt: prismaShop.typOspDetectedAt,
    typOspStatusReason: prismaShop.typOspStatusReason,
    installedAt: prismaShop.installedAt,
    uninstalledAt: prismaShop.uninstalledAt,
    createdAt: prismaShop.createdAt,
    updatedAt: prismaShop.updatedAt,
  };
}

export class PrismaShopRepository implements IShopRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async findById(id: string): AsyncResult<Shop | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { id },
      });
      return ok(shop ? mapToDomainShop(shop) : null);
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to find shop by ID"));
    }
  }
  async findByDomain(
    shopDomain: string,
    options?: FindShopOptions
  ): AsyncResult<Shop | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
      });
      if (!shop) {
        return ok(null);
      }
      if (!options?.includeInactive && !shop.isActive) {
        return ok(null);
      }
      if (!options?.includeUninstalled && shop.uninstalledAt) {
        return ok(null);
      }
      return ok(mapToDomainShop(shop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to find shop by domain"));
    }
  }
  async create(data: CreateShopData): AsyncResult<Shop, AppError> {
    try {
      const rawToken = data.accessToken ?? null;
      const accessToken = typeof rawToken === "string" && rawToken.length > 0
        ? ensureTokenEncrypted(rawToken)
        : rawToken;
      const shop = await this.prisma.shop.create({
        data: {
          id: generateSimpleId("shop"),
          shopDomain: data.shopDomain,
          accessToken,
          email: data.email ?? null,
          name: data.name ?? null,
          plan: data.plan ?? "free",
          ingestionSecret: data.ingestionSecret ?? null,
          primaryDomain: data.primaryDomain ?? null,
          shopTier: data.shopTier ?? null,
          storefrontDomains: [],
          updatedAt: new Date(),
        },
      });
      return ok(mapToDomainShop(shop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to create shop"));
    }
  }
  async update(id: string, data: Partial<ShopUpdateData>): AsyncResult<Shop, AppError> {
    try {
      const shop = await this.prisma.shop.update({
        where: { id },
        data,
      });
      return ok(mapToDomainShop(shop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to update shop"));
    }
  }
  async updateByDomain(
    shopDomain: string,
    data: Partial<ShopUpdateData>
  ): AsyncResult<Shop, AppError> {
    try {
      const shop = await this.prisma.shop.update({
        where: { shopDomain },
        data,
      });
      return ok(mapToDomainShop(shop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to update shop"));
    }
  }
  async upsert(
    shopDomain: string,
    createData: CreateShopData,
    updateData: Partial<ShopUpdateData>
  ): AsyncResult<Shop, AppError> {
    try {
      const rawToken = createData.accessToken ?? null;
      const createAccessToken = typeof rawToken === "string" && rawToken.length > 0
        ? ensureTokenEncrypted(rawToken)
        : rawToken;
      const shop = await this.prisma.shop.upsert({
        where: { shopDomain },
        create: {
          id: generateSimpleId("shop"),
          shopDomain: createData.shopDomain,
          accessToken: createAccessToken,
          email: createData.email ?? null,
          name: createData.name ?? null,
          plan: createData.plan ?? "free",
          ingestionSecret: createData.ingestionSecret ?? null,
          primaryDomain: createData.primaryDomain ?? null,
          shopTier: createData.shopTier ?? null,
          storefrontDomains: [],
          updatedAt: new Date(),
        },
        update: updateData,
      });
      return ok(mapToDomainShop(shop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to upsert shop"));
    }
  }
  async softDelete(id: string): AsyncResult<void, AppError> {
    try {
      await this.prisma.shop.update({
        where: { id },
        data: {
          isActive: false,
          uninstalledAt: new Date(),
        },
      });
      return ok(undefined);
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR, "Failed to soft delete shop"));
    }
  }
  async getBasicById(id: string): AsyncResult<ShopBasic | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { id },
        select: { id: true, shopDomain: true, isActive: true, plan: true },
      });
      if (!shop) return ok(null);
      return ok({
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        plan: shop.plan as PlanId,
      });
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async getBasicByDomain(shopDomain: string): AsyncResult<ShopBasic | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true, shopDomain: true, isActive: true, plan: true },
      });
      if (!shop) return ok(null);
      return ok({
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        plan: shop.plan as PlanId,
      });
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async getIdByDomain(shopDomain: string): AsyncResult<string | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: { id: true },
      });
      return ok(shop?.id ?? null);
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async getWithBilling(shopDomain: string): AsyncResult<ShopWithBilling | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          shopDomain: true,
          isActive: true,
          plan: true,
          monthlyOrderLimit: true,
          consentStrategy: true,
        },
      });
      if (!shop) return ok(null);
      return ok({
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        plan: shop.plan as PlanId,
        monthlyOrderLimit: shop.monthlyOrderLimit,
        consentStrategy: shop.consentStrategy as ConsentStrategy,
      });
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async getWithConsent(shopDomain: string): AsyncResult<ShopWithConsent | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          shopDomain: true,
          isActive: true,
          plan: true,
          consentStrategy: true,
        },
      });
      if (!shop) return ok(null);
      return ok({
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        plan: shop.plan as PlanId,
        consentStrategy: shop.consentStrategy as ConsentStrategy,
      });
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async getWithSecurity(shopDomain: string): AsyncResult<ShopWithSecurity | null, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          shopDomain: true,
          isActive: true,
          plan: true,
          ingestionSecret: true,
          previousIngestionSecret: true,
          previousSecretExpiry: true,
          primaryDomain: true,
          storefrontDomains: true,
        },
      });
      if (!shop) return ok(null);
      return ok({
        id: shop.id,
        shopDomain: shop.shopDomain,
        isActive: shop.isActive,
        plan: shop.plan as PlanId,
        ingestionSecret: shop.ingestionSecret,
        previousIngestionSecret: shop.previousIngestionSecret,
        previousSecretExpiry: shop.previousSecretExpiry,
        primaryDomain: shop.primaryDomain,
        storefrontDomains: shop.storefrontDomains,
      });
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async findManyByIds(ids: string[]): AsyncResult<Shop[], AppError> {
    try {
      const shops = await this.prisma.shop.findMany({
        where: { id: { in: ids } },
      });
      return ok(shops.map(mapToDomainShop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async findManyByDomains(shopDomains: string[]): AsyncResult<Shop[], AppError> {
    try {
      const shops = await this.prisma.shop.findMany({
        where: { shopDomain: { in: shopDomains } },
      });
      return ok(shops.map(mapToDomainShop));
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async findAllActive(): AsyncResult<ShopBasic[], AppError> {
    try {
      const shops = await this.prisma.shop.findMany({
        where: { isActive: true },
        select: { id: true, shopDomain: true, isActive: true, plan: true },
      });
      return ok(
        shops.map((s) => ({
          id: s.id,
          shopDomain: s.shopDomain,
          isActive: s.isActive,
          plan: s.plan as PlanId,
        }))
      );
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async exists(shopDomain: string): AsyncResult<boolean, AppError> {
    try {
      const count = await this.prisma.shop.count({
        where: { shopDomain },
      });
      return ok(count > 0);
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
  async isActive(shopDomain: string): AsyncResult<boolean, AppError> {
    try {
      const shop = await this.prisma.shop.findUnique({
        where: { shopDomain },
        select: { isActive: true },
      });
      return ok(shop?.isActive ?? false);
    } catch (error) {
      return err(AppError.wrap(error, ErrorCode.DB_QUERY_ERROR));
    }
  }
}

export function createShopRepository(prisma: PrismaClient): IShopRepository {
  return new PrismaShopRepository(prisma);
}
