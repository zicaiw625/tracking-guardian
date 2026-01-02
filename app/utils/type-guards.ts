

import type {
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
} from "~/types";
import { isObject } from "~/utils/helpers";

export function isEmailAlertSettings(
  value: unknown
): value is EmailAlertSettings {
  if (!isObject(value)) {
    return false;
  }
  return "email" in value && typeof value.email === "string";
}

export function isSlackAlertSettings(
  value: unknown
): value is SlackAlertSettings {
  if (!isObject(value)) {
    return false;
  }
  return "webhookUrl" in value && typeof value.webhookUrl === "string";
}

export function isTelegramAlertSettings(
  value: unknown
): value is TelegramAlertSettings {
  if (!isObject(value)) {
    return false;
  }
  return (
    "botToken" in value &&
    "chatId" in value &&
    typeof value.botToken === "string" &&
    typeof value.chatId === "string"
  );
}

export function asEmailAlertSettings(
  value: unknown
): EmailAlertSettings | null {
  return isEmailAlertSettings(value) ? value : null;
}

export function asSlackAlertSettings(
  value: unknown
): SlackAlertSettings | null {
  return isSlackAlertSettings(value) ? value : null;
}

export function asTelegramAlertSettings(
  value: unknown
): TelegramAlertSettings | null {
  return isTelegramAlertSettings(value) ? value : null;
}

export interface PixelTemplateConfig {
  platform: string;
  eventMappings?: Record<string, string>;
  clientSideEnabled?: boolean;
  serverSideEnabled?: boolean;
}

export function isPixelTemplateConfig(
  value: unknown
): value is PixelTemplateConfig {
  if (!isObject(value)) {
    return false;
  }

  if (typeof value.platform !== "string") {
    return false;
  }

  if (
    "eventMappings" in value &&
    value.eventMappings !== undefined &&
    (typeof value.eventMappings !== "object" ||
      value.eventMappings === null ||
      Array.isArray(value.eventMappings))
  ) {
    return false;
  }

  if (
    "clientSideEnabled" in value &&
    value.clientSideEnabled !== undefined &&
    typeof value.clientSideEnabled !== "boolean"
  ) {
    return false;
  }

  if (
    "serverSideEnabled" in value &&
    value.serverSideEnabled !== undefined &&
    typeof value.serverSideEnabled !== "boolean"
  ) {
    return false;
  }

  return true;
}

export function isPixelTemplateConfigArray(
  value: unknown
): value is PixelTemplateConfig[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isPixelTemplateConfig(item))
  );
}

export function asPixelTemplateConfigArray(
  value: unknown
): PixelTemplateConfig[] {
  if (isPixelTemplateConfigArray(value)) {
    return value;
  }
  return [];
}

export interface PrismaError {
  code?: string;
  meta?: {
    target?: string[];
    [key: string]: unknown;
  };
  message?: string;
  [key: string]: unknown;
}

export function isPrismaError(error: unknown): error is Error & PrismaError {
  if (!(error instanceof Error)) {
    return false;
  }

  // Error对象本身不是Record类型，但我们可以检查其属性
  const err = error as Error & { code?: unknown; meta?: unknown };
  return (
    typeof err.code === "string" &&
    (err.meta === undefined || typeof err.meta === "object")
  );
}

export function getPrismaErrorCode(error: unknown): string | undefined {
  if (isPrismaError(error)) {
    return error.code;
  }
  return undefined;
}

export function getPrismaErrorTarget(error: unknown): string[] | undefined {
  if (isPrismaError(error) && error.meta?.target) {
    return error.meta.target;
  }
  return undefined;
}

