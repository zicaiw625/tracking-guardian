/**
 * 类型守卫函数 - 用于安全的运行时类型检查
 * 替代不安全的类型断言 (as unknown as)
 */

import type {
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
} from "~/types";

/**
 * 检查是否为 EmailAlertSettings
 */
export function isEmailAlertSettings(
  value: unknown
): value is EmailAlertSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "email" in value &&
    typeof (value as Record<string, unknown>).email === "string"
  );
}

/**
 * 检查是否为 SlackAlertSettings
 */
export function isSlackAlertSettings(
  value: unknown
): value is SlackAlertSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "webhookUrl" in value &&
    typeof (value as Record<string, unknown>).webhookUrl === "string"
  );
}

/**
 * 检查是否为 TelegramAlertSettings
 */
export function isTelegramAlertSettings(
  value: unknown
): value is TelegramAlertSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "botToken" in value &&
    "chatId" in value &&
    typeof (value as Record<string, unknown>).botToken === "string" &&
    typeof (value as Record<string, unknown>).chatId === "string"
  );
}

/**
 * 安全地将未知值转换为 EmailAlertSettings
 * 如果类型不匹配，返回 null
 */
export function asEmailAlertSettings(
  value: unknown
): EmailAlertSettings | null {
  return isEmailAlertSettings(value) ? value : null;
}

/**
 * 安全地将未知值转换为 SlackAlertSettings
 * 如果类型不匹配，返回 null
 */
export function asSlackAlertSettings(
  value: unknown
): SlackAlertSettings | null {
  return isSlackAlertSettings(value) ? value : null;
}

/**
 * 安全地将未知值转换为 TelegramAlertSettings
 * 如果类型不匹配，返回 null
 */
export function asTelegramAlertSettings(
  value: unknown
): TelegramAlertSettings | null {
  return isTelegramAlertSettings(value) ? value : null;
}

/**
 * PixelTemplateConfig 类型守卫
 * 注意：此类型定义与 app/services/batch-pixel-apply.server.ts 中的定义保持一致
 */
export interface PixelTemplateConfig {
  platform: string;
  eventMappings?: Record<string, string>;
  clientSideEnabled?: boolean;
  serverSideEnabled?: boolean;
}

export function isPixelTemplateConfig(
  value: unknown
): value is PixelTemplateConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // platform 是必需的字符串
  if (typeof obj.platform !== "string") {
    return false;
  }

  // eventMappings 是可选的，但如果存在必须是对象
  if (
    "eventMappings" in obj &&
    obj.eventMappings !== undefined &&
    (typeof obj.eventMappings !== "object" ||
      obj.eventMappings === null ||
      Array.isArray(obj.eventMappings))
  ) {
    return false;
  }

  // clientSideEnabled 和 serverSideEnabled 是可选的布尔值
  if (
    "clientSideEnabled" in obj &&
    obj.clientSideEnabled !== undefined &&
    typeof obj.clientSideEnabled !== "boolean"
  ) {
    return false;
  }

  if (
    "serverSideEnabled" in obj &&
    obj.serverSideEnabled !== undefined &&
    typeof obj.serverSideEnabled !== "boolean"
  ) {
    return false;
  }

  return true;
}

/**
 * 检查是否为 PixelTemplateConfig 数组
 */
export function isPixelTemplateConfigArray(
  value: unknown
): value is PixelTemplateConfig[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isPixelTemplateConfig(item))
  );
}

/**
 * 安全地将未知值转换为 PixelTemplateConfig 数组
 */
export function asPixelTemplateConfigArray(
  value: unknown
): PixelTemplateConfig[] {
  if (isPixelTemplateConfigArray(value)) {
    return value;
  }
  return [];
}

/**
 * Prisma错误类型定义
 */
export interface PrismaError {
  code?: string;
  meta?: {
    target?: string[];
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
}

/**
 * 检查是否为Prisma错误
 */
export function isPrismaError(error: unknown): error is Error & PrismaError {
  if (!(error instanceof Error)) {
    return false;
  }
  
  // 检查是否有code属性（Prisma错误的特征）
  const err = error as Record<string, unknown>;
  return (
    typeof err.code === "string" &&
    (err.meta === undefined || typeof err.meta === "object")
  );
}

/**
 * 安全地获取Prisma错误代码
 */
export function getPrismaErrorCode(error: unknown): string | undefined {
  if (isPrismaError(error)) {
    return error.code;
  }
  return undefined;
}

/**
 * 安全地获取Prisma错误的目标字段
 */
export function getPrismaErrorTarget(error: unknown): string[] | undefined {
  if (isPrismaError(error) && error.meta?.target) {
    return error.meta.target;
  }
  return undefined;
}

