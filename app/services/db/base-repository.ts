/**
 * Base Repository Class
 *
 * Provides common database operations with type safety and error handling.
 */

import { type PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import { AppError, ErrorCode, Errors } from "../../utils/errors";
import { logger } from "../../utils/logger.server";
import { ok, err, type Result, type AsyncResult } from "../../types/result";

// =============================================================================
// Types
// =============================================================================

/**
 * Base model with common fields
 */
export interface BaseModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  cursor?: string;
}

/**
 * Query options for find operations
 */
export interface QueryOptions<TSelect = unknown, TInclude = unknown> {
  select?: TSelect;
  include?: TInclude;
}

/**
 * Transaction client type
 */
export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

// =============================================================================
// Base Repository
// =============================================================================

/**
 * Abstract base repository with common CRUD operations.
 *
 * @template TModel - The Prisma model type
 * @template TCreate - The create input type
 * @template TUpdate - The update input type
 */
export abstract class BaseRepository<
  TModel extends BaseModel,
  TCreate,
  TUpdate
> {
  protected readonly db: PrismaClient;
  protected readonly modelName: string;

  constructor(modelName: string) {
    this.db = prisma;
    this.modelName = modelName;
  }

  /**
   * Get the Prisma delegate for this model
   * Must be implemented by subclass
   * 
   * Note: We use a more permissive type here to accommodate
   * Prisma's complex generics. The actual return type should
   * be the specific delegate (e.g., ShopDelegate).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected abstract getDelegate(client?: TransactionClient): any;

  // ===========================================================================
  // Find Operations
  // ===========================================================================

  /**
   * Find a single record by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): AsyncResult<TModel | null, AppError> {
    try {
      const result = await this.getDelegate().findUnique({
        where: { id },
        ...options,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findById"));
    }
  }

  /**
   * Find a single record by ID, throw if not found
   */
  async findByIdOrFail(
    id: string,
    options?: QueryOptions
  ): AsyncResult<TModel, AppError> {
    const result = await this.findById(id, options);
    if (!result.ok) return result;
    if (!result.value) {
      return err(AppError.notFound(this.modelName, id));
    }
    return ok(result.value);
  }

  /**
   * Find first record matching criteria
   */
  async findFirst(
    where: Record<string, unknown>,
    options?: QueryOptions
  ): AsyncResult<TModel | null, AppError> {
    try {
      const result = await this.getDelegate().findFirst({
        where,
        ...options,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findFirst"));
    }
  }

  /**
   * Find all records matching criteria
   */
  async findMany(
    where?: Record<string, unknown>,
    options?: QueryOptions & { orderBy?: Record<string, "asc" | "desc"> }
  ): AsyncResult<TModel[], AppError> {
    try {
      const result = await this.getDelegate().findMany({
        where,
        ...options,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "findMany"));
    }
  }

  /**
   * Find records with pagination
   */
  async findPaginated(
    where: Record<string, unknown> | undefined,
    pagination: PaginationOptions,
    options?: QueryOptions & { orderBy?: Record<string, "asc" | "desc"> }
  ): AsyncResult<PaginatedResult<TModel>, AppError> {
    try {
      const page = pagination.page || 1;
      const pageSize = Math.min(pagination.pageSize || 20, 100);
      const skip = (page - 1) * pageSize;

      const [data, total] = await Promise.all([
        this.getDelegate().findMany({
          where,
          skip,
          take: pageSize + 1, // Get one extra to check hasMore
          ...options,
        }),
        this.getDelegate().count({ where }),
      ]);

      const hasMore = data.length > pageSize;
      const items = hasMore ? data.slice(0, pageSize) : data;

      return ok({
        data: items,
        total,
        page,
        pageSize,
        hasMore,
        cursor: hasMore ? items[items.length - 1]?.id : undefined,
      });
    } catch (error) {
      return err(this.handleError(error, "findPaginated"));
    }
  }

  // ===========================================================================
  // Count Operations
  // ===========================================================================

  /**
   * Count records matching criteria
   */
  async count(where?: Record<string, unknown>): AsyncResult<number, AppError> {
    try {
      const count = await this.getDelegate().count({ where });
      return ok(count);
    } catch (error) {
      return err(this.handleError(error, "count"));
    }
  }

  /**
   * Check if a record exists
   */
  async exists(where: Record<string, unknown>): AsyncResult<boolean, AppError> {
    const result = await this.count(where);
    if (!result.ok) return result;
    return ok(result.value > 0);
  }

  // ===========================================================================
  // Create Operations
  // ===========================================================================

  /**
   * Create a new record
   */
  async create(
    data: TCreate,
    options?: QueryOptions
  ): AsyncResult<TModel, AppError> {
    try {
      const result = await this.getDelegate().create({
        data,
        ...options,
      });
      logger.debug(`${this.modelName} created`, { id: result.id });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "create"));
    }
  }

  // ===========================================================================
  // Update Operations
  // ===========================================================================

  /**
   * Update a record by ID
   */
  async update(
    id: string,
    data: TUpdate,
    options?: QueryOptions
  ): AsyncResult<TModel, AppError> {
    try {
      const result = await this.getDelegate().update({
        where: { id },
        data,
        ...options,
      });
      logger.debug(`${this.modelName} updated`, { id });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "update"));
    }
  }

  /**
   * Update first record matching criteria
   */
  async updateWhere(
    where: Record<string, unknown>,
    data: TUpdate,
    options?: QueryOptions
  ): AsyncResult<TModel, AppError> {
    try {
      // First find the record
      const existing = await this.getDelegate().findFirst({ where });
      if (!existing) {
        return err(AppError.notFound(this.modelName));
      }
      
      // Then update by ID
      const result = await this.getDelegate().update({
        where: { id: existing.id },
        data,
        ...options,
      });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "updateWhere"));
    }
  }

  // ===========================================================================
  // Delete Operations
  // ===========================================================================

  /**
   * Delete a record by ID
   */
  async delete(id: string): AsyncResult<TModel, AppError> {
    try {
      const result = await this.getDelegate().delete({
        where: { id },
      });
      logger.debug(`${this.modelName} deleted`, { id });
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "delete"));
    }
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Execute operations in a transaction
   */
  async transaction<T>(
    fn: (tx: TransactionClient) => Promise<T>
  ): AsyncResult<T, AppError> {
    try {
      const result = await this.db.$transaction(fn);
      return ok(result);
    } catch (error) {
      return err(this.handleError(error, "transaction"));
    }
  }

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  /**
   * Handle Prisma errors and convert to AppError
   */
  protected handleError(error: unknown, operation: string): AppError {
    logger.error(`${this.modelName}.${operation} failed`, error);

    if (error instanceof Error) {
      const prismaError = error as { code?: string; meta?: { target?: string[] } };

      if (prismaError.code === "P2002") {
        const target = prismaError.meta?.target?.join(", ") || "field";
        return new AppError(
          ErrorCode.DB_UNIQUE_CONSTRAINT,
          `${this.modelName} with this ${target} already exists`,
          false,
          { model: this.modelName, constraint: target }
        );
      }

      if (prismaError.code === "P2025") {
        return AppError.notFound(this.modelName);
      }

      if (prismaError.code?.startsWith("P2")) {
        return new AppError(
          ErrorCode.DB_QUERY_ERROR,
          `Database error in ${this.modelName}: ${error.message}`,
          false,
          { model: this.modelName, prismaCode: prismaError.code }
        );
      }
    }

    return Errors.dbQuery(`${this.modelName}.${operation}: ${String(error)}`);
  }
}

