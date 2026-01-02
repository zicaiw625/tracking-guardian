

import type {
  EmailAlertSettings,
  SlackAlertSettings,
  TelegramAlertSettings,
} from "~/types";


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
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  
  if (typeof obj.platform !== "string") {
    return false;
  }

  
  if (
    "eventMappings" in obj &&
    obj.eventMappings !== undefined &&
    (typeof obj.eventMappings !== "object" ||
      obj.eventMappings === null ||
      Array.isArray(obj.eventMappings))
  ) {
    return false;
  }

  
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
  
  
  const err = error as Record<string, unknown>;
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

