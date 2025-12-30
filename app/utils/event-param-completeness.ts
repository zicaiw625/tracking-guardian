import { STANDARD_EVENT_MAPPINGS, type EventMapping } from "../services/event-mapping.server";

export interface ParamCompletenessResult {
  isComplete: boolean;
  completenessRate: number; // 0-100
  requiredParams: string[];
  missingParams: string[];
  presentParams: string[];
}

/**
 * 检查事件的参数完整率
 */
export function checkParamCompleteness(
  eventType: string,
  platform: string,
  params?: Record<string, unknown>
): ParamCompletenessResult {
  const platformMapping = STANDARD_EVENT_MAPPINGS[platform];
  if (!platformMapping) {
    // 未知平台，无法检查
    return {
      isComplete: true,
      completenessRate: 100,
      requiredParams: [],
      missingParams: [],
      presentParams: params ? Object.keys(params) : [],
    };
  }

  // 尝试找到对应的事件映射
  // 事件类型可能是 Shopify 事件（如 checkout_completed）或平台事件（如 purchase）
  let mapping: EventMapping | undefined;

  // 先尝试作为 Shopify 事件查找
  mapping = platformMapping.mappings[eventType];

  // 如果没找到，尝试在映射中查找平台事件名
  if (!mapping) {
    for (const [shopifyEvent, m] of Object.entries(platformMapping.mappings)) {
      if (m.platformEvent === eventType) {
        mapping = m;
        break;
      }
    }
  }

  // 如果还是没找到，使用通用规则
  if (!mapping) {
    // 对于未知事件类型，假设只需要 value 和 currency
    const requiredParams = ["value", "currency"];
    const presentParams = params ? Object.keys(params) : [];
    const missingParams = requiredParams.filter((p) => !(p in (params || {})));

    return {
      isComplete: missingParams.length === 0,
      completenessRate: ((requiredParams.length - missingParams.length) / requiredParams.length) * 100,
      requiredParams,
      missingParams,
      presentParams,
    };
  }

  // 使用映射的必需参数
  const requiredParams = mapping.requiredParams || [];
  const presentParams = params ? Object.keys(params) : [];
  const missingParams = requiredParams.filter((param) => {
    // 检查参数是否存在且不为空
    const paramValue = params?.[param];
    if (paramValue === undefined || paramValue === null) {
      return true;
    }
    // 对于字符串，检查是否为空
    if (typeof paramValue === "string" && paramValue.trim() === "") {
      return true;
    }
    // 对于数组，检查是否为空
    if (Array.isArray(paramValue) && paramValue.length === 0) {
      return false; // 空数组不算缺失，因为可能是可选的
    }
    return false;
  });

  const completenessRate =
    requiredParams.length > 0
      ? ((requiredParams.length - missingParams.length) / requiredParams.length) * 100
      : 100;

  return {
    isComplete: missingParams.length === 0,
    completenessRate: Math.round(completenessRate),
    requiredParams,
    missingParams,
    presentParams,
  };
}

/**
 * 计算事件统计信息
 */
export interface EventStats {
  totalCount: number;
  byEventType: Record<string, number>;
  byPlatform: Record<string, number>;
  byPlatformAndEventType: Record<string, Record<string, number>>;
  paramCompleteness: {
    overall: number; // 平均完整率
    byEventType: Record<string, number>;
    byPlatform: Record<string, number>;
    completeCount: number;
    incompleteCount: number;
  };
}

export function calculateEventStats(
  events: Array<{
    eventType: string;
    platform: string;
    params?: Record<string, unknown>;
  }>
): EventStats {
  const stats: EventStats = {
    totalCount: events.length,
    byEventType: {},
    byPlatform: {},
    byPlatformAndEventType: {},
    paramCompleteness: {
      overall: 0,
      byEventType: {},
      byPlatform: {},
      completeCount: 0,
      incompleteCount: 0,
    },
  };

  let totalCompleteness = 0;
  const completenessByEventType: Record<string, number[]> = {};
  const completenessByPlatform: Record<string, number[]> = {};

  for (const event of events) {
    // 统计触发次数
    stats.byEventType[event.eventType] = (stats.byEventType[event.eventType] || 0) + 1;
    stats.byPlatform[event.platform] = (stats.byPlatform[event.platform] || 0) + 1;

    if (!stats.byPlatformAndEventType[event.platform]) {
      stats.byPlatformAndEventType[event.platform] = {};
    }
    stats.byPlatformAndEventType[event.platform][event.eventType] =
      (stats.byPlatformAndEventType[event.platform][event.eventType] || 0) + 1;

    // 计算参数完整率
    const completeness = checkParamCompleteness(event.eventType, event.platform, event.params);
    totalCompleteness += completeness.completenessRate;

    if (!completenessByEventType[event.eventType]) {
      completenessByEventType[event.eventType] = [];
    }
    completenessByEventType[event.eventType].push(completeness.completenessRate);

    if (!completenessByPlatform[event.platform]) {
      completenessByPlatform[event.platform] = [];
    }
    completenessByPlatform[event.platform].push(completeness.completenessRate);

    if (completeness.isComplete) {
      stats.paramCompleteness.completeCount++;
    } else {
      stats.paramCompleteness.incompleteCount++;
    }
  }

  // 计算平均完整率
  stats.paramCompleteness.overall =
    events.length > 0 ? Math.round(totalCompleteness / events.length) : 100;

  // 计算按事件类型的平均完整率
  for (const [eventType, rates] of Object.entries(completenessByEventType)) {
    stats.paramCompleteness.byEventType[eventType] = Math.round(
      rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    );
  }

  // 计算按平台的平均完整率
  for (const [platform, rates] of Object.entries(completenessByPlatform)) {
    stats.paramCompleteness.byPlatform[platform] = Math.round(
      rates.reduce((sum, rate) => sum + rate, 0) / rates.length
    );
  }

  return stats;
}

