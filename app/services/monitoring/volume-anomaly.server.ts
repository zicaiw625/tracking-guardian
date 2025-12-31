
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";

export interface VolumeAnomalyStats {
  current24h: number;
  previous24h: number;
  changePercent: number;
  isAnomaly: boolean;
  severity: "critical" | "warning" | "info";
  baseline: {
    average7Days?: number;
    average30Days?: number;
    median7Days?: number;
    stdDev?: number;
    min?: number;
    max?: number;
  };
  comparison: {
    vsPrevious24h: {
      changePercent: number;
      isDrop: boolean;
    };
    vs7DayAverage: {
      changePercent: number;
      isDrop: boolean;
    };
    vs30DayAverage?: {
      changePercent: number;
      isDrop: boolean;
    };
    zScore?: number;
  };
  period: {
    start: Date;
    end: Date;
  };
  detectedReason?: string;
  confidence?: number;
}

export interface VolumeAnomalyAlertConfig {
  enabled: boolean;
  threshold: number;
  criticalThreshold?: number;
  minVolume?: number;
  useZScore?: boolean;
  zScoreThreshold?: number;
  byPlatform?: Record<string, number>;
  byEventType?: Record<string, number>;
}

export interface VolumeAnomalyAlertResult {
  triggered: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  details: {
    current24h: number;
    previous24h: number;
    changePercent: number;
    threshold: number;
    baseline?: number;
    zScore?: number;
    affectedPlatforms?: string[];
    affectedEventTypes?: string[];
  };
}

export async function detectVolumeAnomaly(
  shopId: string,
  hours: number = 24
): Promise<VolumeAnomalyStats> {
  const now = new Date();
  const current24hStart = new Date(now);
  current24hStart.setHours(current24hStart.getHours() - hours);

  const previous24hStart = new Date(current24hStart);
  previous24hStart.setHours(previous24hStart.getHours() - hours);

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const current24h = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: { gte: current24hStart },
    },
  });

  const previous24h = await prisma.conversionLog.count({
    where: {
      shopId,
      createdAt: {
        gte: previous24hStart,
        lt: current24hStart,
      },
    },
  });

  const [recent7DaysLogs, recent30DaysLogs] = await Promise.all([
    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.conversionLog.findMany({
      where: {
        shopId,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  const dailyCounts7Days = new Map<string, number>();
  recent7DaysLogs.forEach((log) => {
    const dateStr = log.createdAt.toISOString().split("T")[0];
    dailyCounts7Days.set(dateStr, (dailyCounts7Days.get(dateStr) || 0) + 1);
  });
  const dailyValues7Days = Array.from(dailyCounts7Days.values());
  const average7Days =
    dailyValues7Days.length > 0
      ? dailyValues7Days.reduce((sum, count) => sum + count, 0) / dailyValues7Days.length
      : 0;

  let average30Days: number | undefined;
  if (recent30DaysLogs.length > 0) {
    const dailyCounts30Days = new Map<string, number>();
    recent30DaysLogs.forEach((log) => {
      const dateStr = log.createdAt.toISOString().split("T")[0];
      dailyCounts30Days.set(dateStr, (dailyCounts30Days.get(dateStr) || 0) + 1);
    });
    const dailyValues30Days = Array.from(dailyCounts30Days.values());
    average30Days =
      dailyValues30Days.length > 0
        ? dailyValues30Days.reduce((sum, count) => sum + count, 0) / dailyValues30Days.length
        : undefined;
  }

  const variance7Days =
    dailyValues7Days.length > 0
      ? dailyValues7Days.reduce(
          (sum, count) => sum + Math.pow(count - average7Days, 2),
          0
        ) / dailyValues7Days.length
      : 0;
  const stdDev = Math.sqrt(variance7Days);

  const sorted7Days = [...dailyValues7Days].sort((a, b) => a - b);
  const median7Days =
    sorted7Days.length > 0
      ? sorted7Days.length % 2 === 0
        ? (sorted7Days[sorted7Days.length / 2 - 1] + sorted7Days[sorted7Days.length / 2]) / 2
        : sorted7Days[Math.floor(sorted7Days.length / 2)]
      : 0;

  const changePercentVsPrevious =
    previous24h > 0 ? ((current24h - previous24h) / previous24h) * 100 : 0;
  const changePercentVs7DayAvg =
    average7Days > 0 ? ((current24h - average7Days) / average7Days) * 100 : 0;
  const changePercentVs30DayAvg =
    average30Days && average30Days > 0
      ? ((current24h - average30Days) / average30Days) * 100
      : undefined;

  const zScore = stdDev > 0 ? (current24h - average7Days) / stdDev : 0;

  let isAnomaly = false;
  let severity: "critical" | "warning" | "info" = "info";
  let detectedReason: string | undefined;
  let confidence = 0;

  if (previous24h > 0 && changePercentVsPrevious < -50) {
    isAnomaly = true;
    const dropPercent = Math.abs(changePercentVsPrevious);
    if (dropPercent >= 80) {
      severity = "critical";
      confidence = 90;
    } else if (dropPercent >= 50) {
      severity = "warning";
      confidence = 75;
    }
    detectedReason = `与前24小时对比下降 ${dropPercent.toFixed(1)}% (${previous24h} → ${current24h})`;
  }

  if (average7Days > 0 && changePercentVs7DayAvg < -50) {
    isAnomaly = true;
    const dropPercent = Math.abs(changePercentVs7DayAvg);
    if (dropPercent >= 70 && severity !== "critical") {
      severity = severity === "warning" ? "warning" : "critical";
      confidence = Math.max(confidence, 85);
      detectedReason = `与7天平均对比下降 ${dropPercent.toFixed(1)}% (平均: ${average7Days.toFixed(0)}, 当前: ${current24h})`;
    } else if (dropPercent >= 50 && severity === "info") {
      severity = "warning";
      confidence = Math.max(confidence, 70);
      if (!detectedReason) {
        detectedReason = `与7天平均对比下降 ${dropPercent.toFixed(1)}%`;
      }
    }
  }

  if (stdDev > 0 && zScore < -2) {
    isAnomaly = true;
    if (zScore < -3) {
      severity = "critical";
      confidence = Math.max(confidence, 90);
      detectedReason = `Z-Score ${zScore.toFixed(2)} 表明事件量显著低于正常水平`;
    } else if (zScore < -2 && severity !== "critical") {
      severity = severity === "warning" ? "warning" : "warning";
      confidence = Math.max(confidence, 80);
      if (!detectedReason) {
        detectedReason = `Z-Score ${zScore.toFixed(2)} 表明事件量低于正常水平`;
      }
    }
  }

  return {
    current24h,
    previous24h,
    changePercent: changePercentVsPrevious,
    isAnomaly,
    severity,
    baseline: {
      average7Days: average7Days > 0 ? average7Days : undefined,
      average30Days,
      median7Days: median7Days > 0 ? median7Days : undefined,
      stdDev: stdDev > 0 ? stdDev : undefined,
      min: dailyValues7Days.length > 0 ? Math.min(...dailyValues7Days) : undefined,
      max: dailyValues7Days.length > 0 ? Math.max(...dailyValues7Days) : undefined,
    },
    comparison: {
      vsPrevious24h: {
        changePercent: changePercentVsPrevious,
        isDrop: changePercentVsPrevious < -50,
      },
      vs7DayAverage: {
        changePercent: changePercentVs7DayAvg,
        isDrop: changePercentVs7DayAvg < -50,
      },
      vs30DayAverage: changePercentVs30DayAvg
        ? {
            changePercent: changePercentVs30DayAvg,
            isDrop: changePercentVs30DayAvg < -50,
          }
        : undefined,
      zScore: stdDev > 0 ? zScore : undefined,
    },
    period: {
      start: current24hStart,
      end: now,
    },
    detectedReason,
    confidence: confidence > 0 ? confidence : undefined,
  };
}

export async function detectVolumeAnomalyByPlatform(
  shopId: string,
  hours: number = 24
): Promise<Record<string, VolumeAnomalyStats>> {
  const platforms = await prisma.pixelConfig.findMany({
    where: {
      shopId,
      isActive: true,
    },
    select: {
      platform: true,
    },
    distinct: ["platform"],
  });

  const results: Record<string, VolumeAnomalyStats> = {};

  for (const config of platforms) {
    const platform = config.platform;
    const now = new Date();
    const current24hStart = new Date(now);
    current24hStart.setHours(current24hStart.getHours() - hours);

    const previous24hStart = new Date(current24hStart);
    previous24hStart.setHours(previous24hStart.getHours() - hours);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [current24h, previous24h, recent7DaysLogs] = await Promise.all([
      prisma.conversionLog.count({
        where: {
          shopId,
          platform,
          createdAt: { gte: current24hStart },
        },
      }),
      prisma.conversionLog.count({
        where: {
          shopId,
          platform,
          createdAt: {
            gte: previous24hStart,
            lt: current24hStart,
          },
        },
      }),
      prisma.conversionLog.findMany({
        where: {
          shopId,
          platform,
          createdAt: { gte: sevenDaysAgo },
        },
        select: {
          createdAt: true,
        },
      }),
    ]);

    const dailyCounts = new Map<string, number>();
    recent7DaysLogs.forEach((log) => {
      const dateStr = log.createdAt.toISOString().split("T")[0];
      dailyCounts.set(dateStr, (dailyCounts.get(dateStr) || 0) + 1);
    });
    const dailyValues = Array.from(dailyCounts.values());
    const average7Days =
      dailyValues.length > 0
        ? dailyValues.reduce((sum, count) => sum + count, 0) / dailyValues.length
        : 0;

    const variance =
      dailyValues.length > 0
        ? dailyValues.reduce((sum, count) => sum + Math.pow(count - average7Days, 2), 0) /
          dailyValues.length
        : 0;
    const stdDev = Math.sqrt(variance);

    const changePercent = previous24h > 0 ? ((current24h - previous24h) / previous24h) * 100 : 0;
    const changePercentVsAvg =
      average7Days > 0 ? ((current24h - average7Days) / average7Days) * 100 : 0;
    const zScore = stdDev > 0 ? (current24h - average7Days) / stdDev : 0;

    let isAnomaly = false;
    let severity: "critical" | "warning" | "info" = "info";
    let detectedReason: string | undefined;

    if (previous24h > 0 && changePercent < -50) {
      isAnomaly = true;
      const dropPercent = Math.abs(changePercent);
      severity = dropPercent >= 80 ? "critical" : dropPercent >= 50 ? "warning" : "info";
      detectedReason = `与前24小时对比下降 ${dropPercent.toFixed(1)}%`;
    } else if (average7Days > 0 && changePercentVsAvg < -50) {
      isAnomaly = true;
      const dropPercent = Math.abs(changePercentVsAvg);
      severity = dropPercent >= 70 ? "critical" : "warning";
      detectedReason = `与7天平均对比下降 ${dropPercent.toFixed(1)}%`;
    } else if (stdDev > 0 && zScore < -2) {
      isAnomaly = true;
      severity = zScore < -3 ? "critical" : "warning";
      detectedReason = `Z-Score ${zScore.toFixed(2)} 表明异常`;
    }

    results[platform] = {
      current24h,
      previous24h,
      changePercent,
      isAnomaly,
      severity,
      baseline: {
        average7Days: average7Days > 0 ? average7Days : undefined,
        stdDev: stdDev > 0 ? stdDev : undefined,
      },
      comparison: {
        vsPrevious24h: {
          changePercent,
          isDrop: changePercent < -50,
        },
        vs7DayAverage: {
          changePercent: changePercentVsAvg,
          isDrop: changePercentVsAvg < -50,
        },
        zScore: stdDev > 0 ? zScore : undefined,
      },
      period: {
        start: current24hStart,
        end: now,
      },
      detectedReason,
    };
  }

  return results;
}

export async function checkVolumeAnomalyAlert(
  shopId: string,
  config: VolumeAnomalyAlertConfig,
  hours: number = 24
): Promise<VolumeAnomalyAlertResult> {
  if (!config.enabled) {
    return {
      triggered: false,
      severity: "info",
      message: "事件量骤降告警未启用",
      details: {
        current24h: 0,
        previous24h: 0,
        changePercent: 0,
        threshold: config.threshold,
      },
    };
  }

  const stats = await detectVolumeAnomaly(shopId, hours);

  if (config.minVolume && stats.previous24h < config.minVolume) {
    return {
      triggered: false,
      severity: "info",
      message: `事件量 ${stats.previous24h} 低于最小阈值 ${config.minVolume}，跳过告警`,
      details: {
        current24h: stats.current24h,
        previous24h: stats.previous24h,
        changePercent: stats.changePercent,
        threshold: config.threshold,
      },
    };
  }

  const threshold = config.threshold;
  const criticalThreshold = config.criticalThreshold || threshold * 1.5;
  const absChangePercent = Math.abs(stats.changePercent);

  if (config.useZScore && stats.comparison.zScore !== undefined) {
    const zScoreThreshold = config.zScoreThreshold || -2;
    if (stats.comparison.zScore < zScoreThreshold) {
      const severity =
        stats.comparison.zScore < (zScoreThreshold * 1.5) ? "critical" : "warning";
      return {
        triggered: true,
        severity,
        message: `事件量 Z-Score ${stats.comparison.zScore.toFixed(2)} 低于阈值 ${zScoreThreshold}，可能发生骤降`,
        details: {
          current24h: stats.current24h,
          previous24h: stats.previous24h,
          changePercent: stats.changePercent,
          threshold: zScoreThreshold,
          baseline: stats.baseline.average7Days,
          zScore: stats.comparison.zScore,
        },
      };
    }
  }

  if (absChangePercent >= criticalThreshold && stats.changePercent < 0) {
    const affectedPlatforms: string[] = [];
    const platformStats = await detectVolumeAnomalyByPlatform(shopId, hours);
    Object.entries(platformStats).forEach(([platform, platformStat]) => {
      if (platformStat.isAnomaly && platformStat.severity === "critical") {
        affectedPlatforms.push(platform);
      }
    });

    return {
      triggered: true,
      severity: "critical",
      message: `事件量下降 ${absChangePercent.toFixed(2)}% 超过严重阈值 ${criticalThreshold.toFixed(2)}%`,
      details: {
        current24h: stats.current24h,
        previous24h: stats.previous24h,
        changePercent: stats.changePercent,
        threshold: criticalThreshold,
        baseline: stats.baseline.average7Days,
        affectedPlatforms: affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
      },
    };
  }

  if (absChangePercent >= threshold && stats.changePercent < 0) {
    return {
      triggered: true,
      severity: "warning",
      message: `事件量下降 ${absChangePercent.toFixed(2)}% 超过阈值 ${threshold.toFixed(2)}%`,
      details: {
        current24h: stats.current24h,
        previous24h: stats.previous24h,
        changePercent: stats.changePercent,
        threshold,
        baseline: stats.baseline.average7Days,
      },
    };
  }

  return {
    triggered: false,
    severity: "info",
    message: "事件量正常",
    details: {
      current24h: stats.current24h,
      previous24h: stats.previous24h,
      changePercent: stats.changePercent,
      threshold,
    },
  };
}

export async function getVolumeHistoryByHour(
  shopId: string,
  hours: number = 48
): Promise<Array<{
  timestamp: string;
  hour: number;
  count: number;
}>> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const logs = await prisma.conversionLog.findMany({
    where: {
      shopId,
      createdAt: { gte: since },
    },
    select: {
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const hourMap = new Map<string, number>();

  logs.forEach((log) => {
    const date = new Date(log.createdAt);
    const dateStr = date.toISOString().split("T")[0];
    const hour = date.getHours();
    const key = `${dateStr}:${hour}`;
    hourMap.set(key, (hourMap.get(key) || 0) + 1);
  });

  return Array.from(hourMap.entries())
    .map(([key, count]) => {
      const [date, hourStr] = key.split(":");
      return {
        timestamp: `${date}T${hourStr.padStart(2, "0")}:00:00.000Z`,
        hour: parseInt(hourStr, 10),
        count,
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

