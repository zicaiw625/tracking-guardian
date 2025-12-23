/**
 * Prisma Infrastructure Layer
 *
 * Provides Prisma implementations of domain repository interfaces.
 * This layer handles all database-specific concerns.
 */

export {
  PrismaShopRepository,
  createShopRepository,
} from "./shop.repository.server";

