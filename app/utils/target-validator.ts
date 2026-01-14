export type ValidTarget = 
  | "purchase.thank-you.block.render"
  | "customer-account.order-status.block.render";

export const VALID_TARGETS: readonly ValidTarget[] = [
  "purchase.thank-you.block.render",
  "customer-account.order-status.block.render",
] as const;

export const DEPRECATED_TARGETS: readonly string[] = [
  "purchase.thank-you.block",
  "customer-account.order-status.block",
  "checkout.thank-you.block.render",
  "checkout.order-status.block.render",
] as const;

export interface TargetValidationResult {
  valid: boolean;
  isDeprecated: boolean;
  error?: string;
  suggestion?: string;
}

export function validateTarget(target: string): TargetValidationResult {
  if (!target || typeof target !== "string" || target.trim().length === 0) {
    return {
      valid: false,
      isDeprecated: false,
      error: "Target 不能为空",
      suggestion: `请使用以下有效的 target: ${VALID_TARGETS.join(", ")}`,
    };
  }
  const normalizedTarget = target.trim();
  if (VALID_TARGETS.includes(normalizedTarget as ValidTarget)) {
    return { valid: true, isDeprecated: false };
  }
  if (DEPRECATED_TARGETS.includes(normalizedTarget)) {
    let suggestion = "请使用最新的 target 名称";
    if (normalizedTarget.includes("thank-you") && !normalizedTarget.includes("purchase.thank-you.block.render")) {
      suggestion = `请使用 "purchase.thank-you.block.render" 替代 "${normalizedTarget}"`;
    } else if (normalizedTarget.includes("order-status") && !normalizedTarget.includes("customer-account.order-status.block.render")) {
      suggestion = `请使用 "customer-account.order-status.block.render" 替代 "${normalizedTarget}"（注意：仅支持 Customer Accounts 体系）`;
    } else if (normalizedTarget.includes("checkout.")) {
      if (normalizedTarget.includes("thank-you")) {
        suggestion = `请使用 "purchase.thank-you.block.render" 替代已弃用的 "${normalizedTarget}"`;
      } else if (normalizedTarget.includes("order-status")) {
        suggestion = `请使用 "customer-account.order-status.block.render" 替代已弃用的 "${normalizedTarget}"（注意：仅支持 Customer Accounts 体系）`;
      }
    }
    return {
      valid: false,
      isDeprecated: true,
      error: `Target "${normalizedTarget}" 已被弃用`,
      suggestion,
    };
  }
  return {
    valid: false,
    isDeprecated: false,
    error: `未知的 target: "${normalizedTarget}"`,
    suggestion: `请使用以下有效的 target: ${VALID_TARGETS.join(", ")}。注意：不要使用已弃用的 target 名称，如 checkout.thank-you.block.render 或 checkout.order-status.block.render。`,
  };
}

export function getTargetDisplayName(target: string): string {
  switch (target) {
    case "purchase.thank-you.block.render":
      return "Thank You 页面";
    case "customer-account.order-status.block.render":
      return "Order Status 页面 (Customer Accounts)";
    default:
      return target;
  }
}
