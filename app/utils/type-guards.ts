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
  if (
    "botToken" in value &&
    "chatId" in value &&
    typeof value.botToken === "string" &&
    typeof value.chatId === "string"
  ) {
    const token = value.botToken.trim();
    const chatId = value.chatId.trim();
    if (!chatId) return false;
    return /^\d+:[A-Za-z0-9_-]+$/.test(token);
  }
  return false;
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
