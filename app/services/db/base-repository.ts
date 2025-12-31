

import { type PrismaClient } from "@prisma/client";
import { getDb } from "../../container";
import { AppError, ErrorCode, Errors } from "../../utils/errors";
import { logger } from "../../utils/logger.server";
import { ok, err, type Result, type AsyncResult } from "../../types/result";
import { isPrismaError, getPrismaErrorCode, getPrismaErrorTarget } from "../../utils/type-guards";

export interface BaseModel {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  cursor?: string;
}

export interface QueryOptions<TSelect = unknown, TInclude = unknown> {
  select?: TSelect;
  include?: TInclude;
}

export type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export abstract class BaseRepository<
  TModel extends BaseModel,
  TCreate,
  TUpdate
> {
  protected readonly db: PrismaClient;
  protected readonly modelName: string;

  constructor(modelName: string, db?: PrismaClient) {
    this.db = db ?? getDb();
    this.modelName = modelName;
  }

  // Returns Prisma delegate which varies by model type, so we use any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected abstract getDelegate(client?: TransactionClient): any;

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
          take: pageSize + 1,
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

  async count(where?: Record<string, unknown>): AsyncResult<number, AppError> {
    try {
      const count = await this.getDelegate().count({ where });
      return ok(count);
    } catch (error) {
      return err(this.handleError(error, "count"));
    }
  }

  async exists(where: Record<string, unknown>): AsyncResult<boolean, AppError> {
    const result = await this.count(where);
    if (!result.ok) return result;
    return ok(result.value > 0);
  }

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

  async updateWhere(
    where: Record<string, unknown>,
    data: TUpdate,
    options?: QueryOptions
  ): AsyncResult<TModel, AppError> {
    try {

      const existing = await this.getDelegate().findFirst({ where });
      if (!existing) {
        return err(AppError.notFound(this.modelName));
      }

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

  protected handleError(error: unknown, operation: string): AppError {
    logger.error(`${this.modelName}.${operation} failed`, error);

    if (isPrismaError(error)) {
      const errorCode = getPrismaErrorCode(error);

      if (errorCode === "P2002") {
        const target = getPrismaErrorTarget(error)?.join(", ") || "field";
        return new AppError(
          ErrorCode.DB_UNIQUE_CONSTRAINT,
          `${this.modelName} with this ${target} already exists`,
          false,
          { model: this.modelName, constraint: target }
        );
      }

      if (errorCode === "P2025") {
        return AppError.notFound(this.modelName);
      }

      if (errorCode?.startsWith("P2")) {
        return new AppError(
          ErrorCode.DB_QUERY_ERROR,
          `Database error in ${this.modelName}: ${error.message}`,
          false,
          { model: this.modelName, prismaCode: errorCode }
        );
      }
    }

    return Errors.dbQuery(`${this.modelName}.${operation}: ${String(error)}`);
  }
}

