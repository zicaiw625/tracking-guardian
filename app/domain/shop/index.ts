

export {
  type Shop,
  type ShopBasic,
  type ShopWithBilling,
  type ShopWithConsent,
  type ShopWithSecurity,
  type ShopTier,
  type ConsentStrategy,
  type ShopStatus,
  createShop,
  getShopStatus,
  // P0-2: v1.0 版本不包含任何 PCD/PII 处理，因此移除 isPiiFullyEnabled 导出
  isWithinUsageLimits,
  getAllowedDomains,
  isDomainAllowed,
  isInSecretGracePeriod,
  getEffectiveConsentStrategy,
  isValidConsentStrategy,
  isValidShopTier,
} from "./shop.entity";

export {
  type IShopRepository,
  type FindShopOptions,
  type UpdateShopOptions,
  type ShopUpdateData,
  type CreateShopData,
  type ShopEvent,
  type ShopCreatedEvent,
  type ShopPlanChangedEvent,
  type ShopUninstalledEvent,
  type ShopReinstalledEvent,
  type ShopDomainEvent,
} from "./shop.repository";

