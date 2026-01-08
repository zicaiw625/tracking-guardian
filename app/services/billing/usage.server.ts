import { randomUUID } from "crypto";
import prisma from "~/db.server";
import { logger } from "~/utils/logger.server";
import { billingCache } from "~/utils/cache";
import type { PlanId } from "./plans";
import { getPlanLimit } from "./plans";

export interface UsageStats {
  currentMonth: {
    orders: number;
    events: number;
    platforms: Record<string, number>;
  };
  previousMonth: {
    orders: number;
    events: number;
  };
  limit: number;
  usagePercentage: number;
  isOverLimit: boolean;
  trend: "up" | "down" | "stable";
}

export async function getMonthlyUsage(
  shopId: string,
  planId: PlanId
): Promise<UsageStats> {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const [currentMonthLogs, previousMonthLogs, currentMonthReceipts] = await Promise.all([

    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: currentMonthStart },
        status: "sent",
      },
      select: {
        platform: true,
        orderId: true,
      },
    }),

    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: {
          gte: previousMonthStart,
          lte: previousMonthEnd,
        },
        status: "sent",
      },
      select: {
        orderId: true,
      },
    }),

    prisma.pixelEventReceipt.findMany({
      where: {
        shopId,
        createdAt: { gte: currentMonthStart },
      },
      select: {
        orderId: true,
      },
    }),
  ]);

  const currentMonthOrderIds = new Set([
    ...currentMonthLogs.map((log) => log.orderId),
    ...currentMonthReceipts.map((receipt) => receipt.orderId),
  ]);
  const currentMonthOrders = currentMonthOrderIds.size;

  const platformCounts: Record<string, number> = {};
  currentMonthLogs.forEach((log) => {
    platformCounts[log.platform] = (platformCounts[log.platform] || 0) + 1;
  });

  const previousMonthOrderIds = new Set(previousMonthLogs.map((log) => log.orderId));
  const previousMonthOrders = previousMonthOrderIds.size;

  const limit = getPlanLimit(planId);
  const usagePercentage = limit > 0 ? (currentMonthOrders / limit) * 100 : 0;
  const isOverLimit = limit > 0 && currentMonthOrders >= limit;

  let trend: "up" | "down" | "stable" = "stable";
  // 安全除零检查: 只有当previousMonthOrders > 0时才进行除法运算
  if (previousMonthOrders > 0) {
    const change = ((currentMonthOrders - previousMonthOrders) / previousMonthOrders) * 100;
    if (change > 5) {
      trend = "up";
    } else if (change < -5) {
      trend = "down";
    }
  } else if (currentMonthOrders > 0) {
    // 如果上个月没有订单但这个月有,趋势为上升
    trend = "up";
  }
  // else: 如果两个月份都没有订单,趋势保持stable(默认值)

  return {
    currentMonth: {
      orders: currentMonthOrders,
      events: currentMonthLogs.length,
      platforms: platformCounts,
    },
    previousMonth: {
      orders: previousMonthOrders,
      events: previousMonthLogs.length,
    },
    limit,
    usagePercentage,
    isOverLimit,
    trend,
  };
}

export async function checkUsageLimit(
  shopId: string,
  planId: PlanId
): Promise<{ allowed: boolean; reason?: string; usage?: UsageStats }> {
  const usage = await getMonthlyUsage(shopId, planId);

  if (usage.isOverLimit) {
    return {
      allowed: false,
      reason: `本月订单数（${usage.currentMonth.orders}）已达到套餐限制（${usage.limit}）。请升级套餐以继续使用。`,
      usage,
    };
  }

  if (usage.usagePercentage >= 80 && usage.usagePercentage < 100) {
    logger.warn(`Usage approaching limit for shop ${shopId}`, {
      usagePercentage: usage.usagePercentage,
      currentOrders: usage.currentMonth.orders,
      limit: usage.limit,
    });
  }

  return {
    allowed: true,
    usage,
  };
}

export interface MonthlyUsageRecord {
  id: string;
  shopId: string;
  yearMonth: string;
  sentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncrementResult {
  incremented: boolean;
  current: number;
}

export interface ReservationResult {
  reserved: boolean;
  current: number;
  limit: number;
  remaining: number;
}

export function getCurrentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getMonthDateRange(yearMonth: string): { start: Date; end: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

export async function getOrCreateMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<MonthlyUsageRecord> {
  const ym = yearMonth || getCurrentYearMonth();

  return await prisma.monthlyUsage.upsert({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth: ym,
      },
    },
    create: {
      id: randomUUID(),
      shopId,
      yearMonth: ym,
      sentCount: 0,
      updatedAt: new Date(),
    },
    update: {},
  });
}

export async function getMonthlyUsageCount(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();

  const usage = await prisma.monthlyUsage.findUnique({
    where: {
      shopId_yearMonth: {
        shopId,
        yearMonth: ym,
      },
    },
    select: {
      sentCount: true,
    },
  });

  return usage?.sentCount || 0;
}

export async function isOrderAlreadyCounted(
  shopId: string,
  orderId: string
): Promise<boolean> {
  const job = await prisma.conversionJob.findUnique({
    where: {
      shopId_orderId: {
        shopId,
        orderId,
      },
    },
    select: {
      status: true,
    },
  });

  if (job?.status === "completed") {
    return true;
  }

  const log = await prisma.conversionLog.findFirst({
    where: {
      shopId,
      orderId,
      status: "sent",
    },
  });

  return !!log;
}

export async function incrementMonthlyUsage(
  shopId: string,
  orderId: string
): Promise<number> {
  const yearMonth = getCurrentYearMonth();

  let actuallyIncremented = false;
  const result = await prisma.$transaction(
    async (tx) => {
    const job = await tx.conversionJob.findUnique({
      where: {
        shopId_orderId: {
          shopId,
          orderId,
        },
      },
      select: {
        status: true,
      },
    });

    if (job?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return usage?.sentCount || 0;
    }

    const log = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        status: "sent",
      },
    });

    if (log) {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return usage?.sentCount || 0;
    }

    await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      create: {
        id: randomUUID(),
        shopId,
        yearMonth,
        sentCount: 1,
        updatedAt: new Date(),
      },
      update: {
        sentCount: {
          increment: 1,
        },
      },
    });

    actuallyIncremented = true;

    const updated = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return updated?.sentCount || 0;
    },
    {
      isolationLevel: "ReadCommitted",
      timeout: 5000,
    }
  );

  // 无论是否实际增加，都删除缓存以确保一致性
  // 因为查询操作可能改变了缓存状态，且即使订单已计数，也可能有并发更新
  billingCache.delete(`billing:${shopId}`);
  return result;
}

export async function incrementMonthlyUsageIdempotent(
  shopId: string,
  orderId: string
): Promise<IncrementResult> {
  const yearMonth = getCurrentYearMonth();

  const result = await prisma.$transaction(
    async (tx) => {
    const job = await tx.conversionJob.findUnique({
      where: {
        shopId_orderId: {
          shopId,
          orderId,
        },
      },
      select: {
        status: true,
      },
    });

    if (job?.status === "completed") {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return {
        incremented: false,
        current: usage?.sentCount || 0,
      };
    }

    const log = await tx.conversionLog.findFirst({
      where: {
        shopId,
        orderId,
        status: "sent",
      },
    });

    if (log) {
      const usage = await tx.monthlyUsage.findUnique({
        where: {
          shopId_yearMonth: {
            shopId,
            yearMonth,
          },
        },
        select: {
          sentCount: true,
        },
      });
      return {
        incremented: false,
        current: usage?.sentCount || 0,
      };
    }

    await tx.monthlyUsage.upsert({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      create: {
        id: randomUUID(),
        shopId,
        yearMonth,
        sentCount: 1,
        updatedAt: new Date(),
      },
      update: {
        sentCount: {
          increment: 1,
        },
      },
    });

    const updated = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return {
      incremented: true,
      current: updated?.sentCount || 0,
    };
    },
    {
      isolationLevel: "ReadCommitted",
      timeout: 5000,
    }
  );

  // 无论是否实际增加，都删除缓存以确保一致性
  // 因为查询操作可能改变了缓存状态
  billingCache.delete(`billing:${shopId}`);
  return result;
}

export async function tryReserveUsageSlot(
  shopId: string,
  orderId: string,
  limit: number
): Promise<ReservationResult> {
  const yearMonth = getCurrentYearMonth();

  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const job = await tx.conversionJob.findUnique({
            where: {
              shopId_orderId: {
                shopId,
                orderId,
              },
            },
            select: {
              status: true,
            },
          });

          if (job?.status === "completed") {
            const usage = await tx.monthlyUsage.findUnique({
              where: {
                shopId_yearMonth: {
                  shopId,
                  yearMonth,
                },
              },
              select: {
                sentCount: true,
              },
            });
            const current = usage?.sentCount || 0;
            return {
              reserved: false,
              current,
              limit,
              remaining: Math.max(0, limit - current),
            };
          }

          const log = await tx.conversionLog.findFirst({
            where: {
              shopId,
              orderId,
              status: "sent",
            },
          });

          if (log) {
            const usage = await tx.monthlyUsage.findUnique({
              where: {
                shopId_yearMonth: {
                  shopId,
                  yearMonth,
                },
              },
              select: {
                sentCount: true,
              },
            });
            const current = usage?.sentCount || 0;
            return {
              reserved: false,
              current,
              limit,
              remaining: Math.max(0, limit - current),
            };
          }

          // 使用 upsert 确保记录存在，避免并发创建问题
          await tx.monthlyUsage.upsert({
            where: {
              shopId_yearMonth: {
                shopId,
                yearMonth,
              },
            },
            create: {
              id: randomUUID(),
              shopId,
              yearMonth,
              sentCount: 0,
              updatedAt: new Date(),
            },
            update: {},
          });

          // 使用原子更新操作来避免竞态条件
          // WHERE条件确保只有在sentCount < limit时才会更新
          const updated = await tx.$executeRaw`
            UPDATE "MonthlyUsage"
            SET "sentCount" = "sentCount" + 1, "updatedAt" = NOW()
            WHERE "shopId" = ${shopId}
              AND "yearMonth" = ${yearMonth}
              AND "sentCount" < ${limit}
          `;

          if (updated === 0) {
            // 更新失败,说明已经达到或超过限制
            // 重新读取当前值以返回准确的current值
            const currentUsage = await tx.monthlyUsage.findUnique({
              where: {
                shopId_yearMonth: {
                  shopId,
                  yearMonth,
                },
              },
              select: {
                sentCount: true,
              },
            });
            
            const current = currentUsage?.sentCount || 0;
            return {
              reserved: false,
              current,
              limit,
              remaining: 0,
            };
          }

          // 更新成功,读取最终值
          const finalUsage = await tx.monthlyUsage.findUnique({
            where: {
              shopId_yearMonth: {
                shopId,
                yearMonth,
              },
            },
            select: {
              sentCount: true,
            },
          });

          const current = finalUsage?.sentCount || 0;
          
          // 额外验证: 确保更新后的值不超过限制(防御性编程)
          if (current > limit) {
            logger.error('Usage count exceeded limit after update', {
              shopId,
              yearMonth,
              current,
              limit,
              orderId,
            });
            // 虽然不应该发生,但返回失败状态
            return {
              reserved: false,
              current,
              limit,
              remaining: 0,
            };
          }

          return {
            reserved: true,
            current,
            limit,
            remaining: Math.max(0, limit - current),
          };
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5000,
        }
      );

      // 无论是否成功保留，都删除缓存以确保一致性
      billingCache.delete(`billing:${shopId}`);

      return result;
    } catch (error) {
      lastError = error;

      // 检查是否是序列化错误
      const isPrismaError_ = error && typeof error === 'object' && 'code' in error;
      const errorCode = isPrismaError_ ? (error as { code?: string }).code : null;
      const isSerializationError = errorCode === 'P40001' || (errorCode?.startsWith('P40') ?? false);

      if (isSerializationError && attempt < maxRetries - 1) {
        // 指数退避重试
        const backoffMs = 50 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // 如果不是序列化错误或已达到最大重试次数，抛出错误
      throw error;
    }
  }

  // 如果所有重试都失败，返回错误结果
  logger.error('tryReserveUsageSlot failed after retries', {
    shopId,
    orderId,
    limit,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });

  // 返回一个错误状态，但尽量提供当前的usage信息
  try {
    const usage = await getMonthlyUsageCount(shopId, yearMonth);
    return {
      reserved: false,
      current: usage,
      limit,
      remaining: Math.max(0, limit - usage),
    };
  } catch {
    // 如果获取usage也失败，返回默认值
    return {
      reserved: false,
      current: 0,
      limit,
      remaining: 0,
    };
  }
}

export async function decrementMonthlyUsage(
  shopId: string,
  yearMonth?: string
): Promise<number> {
  const ym = yearMonth || getCurrentYearMonth();

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "MonthlyUsage"
      SET "sentCount" = GREATEST("sentCount" - 1, 0), "updatedAt" = NOW()
      WHERE "shopId" = ${shopId}
        AND "yearMonth" = ${ym}
    `;

    const usage = await tx.monthlyUsage.findUnique({
      where: {
        shopId_yearMonth: {
          shopId,
          yearMonth: ym,
        },
      },
      select: {
        sentCount: true,
      },
    });

    return usage?.sentCount || 0;
  });

  billingCache.delete(`billing:${shopId}`);
  return result;
}
