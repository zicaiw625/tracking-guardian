

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

