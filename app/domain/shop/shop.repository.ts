import type { Result, AsyncResult } from "../../types/result";
import type { AppError } from "../../utils/errors";
import type { PlanId } from "../../services/billing/plans";
import type {
  Shop,
  ShopBasic,
  ShopWithBilling,
  ShopWithConsent,
  ShopWithSecurity,
  ConsentStrategy,
} from "./shop.entity";

export interface FindShopOptions {
  includeInactive?: boolean;
  includeUninstalled?: boolean;
}

export interface UpdateShopOptions {
  updates: Partial<ShopUpdateData>;
}

export interface ShopUpdateData {
  email: string | null;
  name: string | null;
  plan: PlanId;
  monthlyOrderLimit: number;
  isActive: boolean;
  consentStrategy: ConsentStrategy;
  dataRetentionDays: number;
  ingestionSecret: string | null;
  previousIngestionSecret: string | null;
  previousSecretExpiry: Date | null;
  primaryDomain: string | null;
  storefrontDomains: string[];
  webPixelId: string | null;
  shopTier: "plus" | "non_plus" | "unknown" | null;
  typOspPagesEnabled: boolean | null;
  typOspLastCheckedAt: Date | null;
  typOspDetectedAt: Date | null;
  typOspStatusReason: string | null;
  uninstalledAt: Date | null;
}

export interface CreateShopData {
  shopDomain: string;
  accessToken?: string | null;
  email?: string | null;
  name?: string | null;
  plan?: PlanId;
  ingestionSecret?: string | null;
  primaryDomain?: string | null;
  shopTier?: "plus" | "non_plus" | "unknown" | null;
}

export interface IShopRepository {
  findById(id: string): AsyncResult<Shop | null, AppError>;
  findByDomain(shopDomain: string, options?: FindShopOptions): AsyncResult<Shop | null, AppError>;
  create(data: CreateShopData): AsyncResult<Shop, AppError>;
  update(id: string, data: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;
  updateByDomain(shopDomain: string, data: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;
  upsert(shopDomain: string, createData: CreateShopData, updateData: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;
  softDelete(id: string): AsyncResult<void, AppError>;
  getBasicById(id: string): AsyncResult<ShopBasic | null, AppError>;
  getBasicByDomain(shopDomain: string): AsyncResult<ShopBasic | null, AppError>;
  getIdByDomain(shopDomain: string): AsyncResult<string | null, AppError>;
  getWithBilling(shopDomain: string): AsyncResult<ShopWithBilling | null, AppError>;
  getWithConsent(shopDomain: string): AsyncResult<ShopWithConsent | null, AppError>;
  getWithSecurity(shopDomain: string): AsyncResult<ShopWithSecurity | null, AppError>;
  findManyByIds(ids: string[]): AsyncResult<Shop[], AppError>;
  findManyByDomains(shopDomains: string[]): AsyncResult<Shop[], AppError>;
  findAllActive(): AsyncResult<ShopBasic[], AppError>;
  exists(shopDomain: string): AsyncResult<boolean, AppError>;
  isActive(shopDomain: string): AsyncResult<boolean, AppError>;
}

export interface ShopEvent {
  readonly shopId: string;
  readonly shopDomain: string;
  readonly occurredAt: Date;
}

export interface ShopCreatedEvent extends ShopEvent {
  readonly type: "shop_created";
  readonly plan: PlanId;
}

export interface ShopPlanChangedEvent extends ShopEvent {
  readonly type: "shop_plan_changed";
  readonly previousPlan: PlanId;
  readonly newPlan: PlanId;
}

export interface ShopUninstalledEvent extends ShopEvent {
  readonly type: "shop_uninstalled";
}

export interface ShopReinstalledEvent extends ShopEvent {
  readonly type: "shop_reinstalled";
}

export type ShopDomainEvent =
  | ShopCreatedEvent
  | ShopPlanChangedEvent
  | ShopUninstalledEvent
  | ShopReinstalledEvent;
