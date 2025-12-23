/**
 * Shop Repository Interface
 *
 * Defines the contract for shop data access.
 * Implementations should handle persistence details (e.g., Prisma, in-memory).
 */

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

// =============================================================================
// Query Options
// =============================================================================

/**
 * Options for finding shops
 */
export interface FindShopOptions {
  /** Include inactive shops */
  includeInactive?: boolean;
  /** Include uninstalled shops */
  includeUninstalled?: boolean;
}

/**
 * Options for updating shop
 */
export interface UpdateShopOptions {
  /** Fields to update */
  updates: Partial<ShopUpdateData>;
}

/**
 * Data that can be updated on a shop
 */
export interface ShopUpdateData {
  email: string | null;
  name: string | null;
  plan: PlanId;
  monthlyOrderLimit: number;
  isActive: boolean;
  piiEnabled: boolean;
  pcdAcknowledged: boolean;
  pcdAcknowledgedAt: Date | null;
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

/**
 * Data for creating a new shop
 */
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

// =============================================================================
// Repository Interface
// =============================================================================

/**
 * Shop repository interface
 *
 * Defines all data access operations for shops.
 * Implementations handle the actual persistence logic.
 */
export interface IShopRepository {
  // =========================================================================
  // Basic CRUD Operations
  // =========================================================================

  /**
   * Find a shop by ID
   */
  findById(id: string): AsyncResult<Shop | null, AppError>;

  /**
   * Find a shop by domain
   */
  findByDomain(shopDomain: string, options?: FindShopOptions): AsyncResult<Shop | null, AppError>;

  /**
   * Create a new shop
   */
  create(data: CreateShopData): AsyncResult<Shop, AppError>;

  /**
   * Update an existing shop
   */
  update(id: string, data: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;

  /**
   * Update a shop by domain
   */
  updateByDomain(shopDomain: string, data: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;

  /**
   * Upsert a shop (create or update)
   */
  upsert(shopDomain: string, createData: CreateShopData, updateData: Partial<ShopUpdateData>): AsyncResult<Shop, AppError>;

  /**
   * Delete a shop (soft delete - set uninstalledAt)
   */
  softDelete(id: string): AsyncResult<void, AppError>;

  // =========================================================================
  // Specialized Queries
  // =========================================================================

  /**
   * Get basic shop info by ID
   */
  getBasicById(id: string): AsyncResult<ShopBasic | null, AppError>;

  /**
   * Get basic shop info by domain
   */
  getBasicByDomain(shopDomain: string): AsyncResult<ShopBasic | null, AppError>;

  /**
   * Get shop ID by domain
   */
  getIdByDomain(shopDomain: string): AsyncResult<string | null, AppError>;

  /**
   * Get shop with billing information
   */
  getWithBilling(shopDomain: string): AsyncResult<ShopWithBilling | null, AppError>;

  /**
   * Get shop with consent settings
   */
  getWithConsent(shopDomain: string): AsyncResult<ShopWithConsent | null, AppError>;

  /**
   * Get shop with security settings
   */
  getWithSecurity(shopDomain: string): AsyncResult<ShopWithSecurity | null, AppError>;

  // =========================================================================
  // Batch Operations
  // =========================================================================

  /**
   * Get multiple shops by IDs
   */
  findManyByIds(ids: string[]): AsyncResult<Shop[], AppError>;

  /**
   * Get multiple shops by domains
   */
  findManyByDomains(shopDomains: string[]): AsyncResult<Shop[], AppError>;

  /**
   * Get all active shops
   */
  findAllActive(): AsyncResult<ShopBasic[], AppError>;

  // =========================================================================
  // Existence Checks
  // =========================================================================

  /**
   * Check if a shop exists by domain
   */
  exists(shopDomain: string): AsyncResult<boolean, AppError>;

  /**
   * Check if a shop is active
   */
  isActive(shopDomain: string): AsyncResult<boolean, AppError>;
}

// =============================================================================
// Events (for domain event sourcing if needed later)
// =============================================================================

/**
 * Base shop event
 */
export interface ShopEvent {
  readonly shopId: string;
  readonly shopDomain: string;
  readonly occurredAt: Date;
}

/**
 * Shop created event
 */
export interface ShopCreatedEvent extends ShopEvent {
  readonly type: "shop_created";
  readonly plan: PlanId;
}

/**
 * Shop plan changed event
 */
export interface ShopPlanChangedEvent extends ShopEvent {
  readonly type: "shop_plan_changed";
  readonly previousPlan: PlanId;
  readonly newPlan: PlanId;
}

/**
 * Shop uninstalled event
 */
export interface ShopUninstalledEvent extends ShopEvent {
  readonly type: "shop_uninstalled";
}

/**
 * Shop reinstalled event
 */
export interface ShopReinstalledEvent extends ShopEvent {
  readonly type: "shop_reinstalled";
}

/**
 * All shop events
 */
export type ShopDomainEvent =
  | ShopCreatedEvent
  | ShopPlanChangedEvent
  | ShopUninstalledEvent
  | ShopReinstalledEvent;

