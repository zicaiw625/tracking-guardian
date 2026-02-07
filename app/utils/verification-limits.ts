
import type { TFunction } from "i18next";

export const STRICT_SANDBOX_FIELD_LIMITATIONS: Record<string, string[]> = {
  checkout_completed: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_started: ["buyer.email", "buyer.phone", "deliveryAddress", "shippingAddress", "billingAddress"],
  checkout_contact_info_submitted: ["buyer.email", "buyer.phone"],
  checkout_shipping_info_submitted: ["deliveryAddress", "shippingAddress"],
  payment_info_submitted: ["billingAddress"],
  product_added_to_cart: [],
  product_viewed: [],
  page_viewed: [],
};

export const STRICT_SANDBOX_UNAVAILABLE_EVENTS = [
  "refund",
  "order_cancelled",
  "order_edited",
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
];

export interface VerificationEventResultLike {
  eventType: string;
  status: string;
  discrepancies?: string[];
  params?: { value?: number };
}

export function getEventSandboxLimitations(result: VerificationEventResultLike, t?: TFunction): string[] {
  const limitations: string[] = [];
  const eventType = result.eventType;
  const knownLimitations = STRICT_SANDBOX_FIELD_LIMITATIONS[eventType] || [];
  
  const translate = (key: string, options?: any, fallback?: string) => {
    if (!t) {
      return fallback || key;
    }
    const result = t(key, options);
    return typeof result === "string" ? result : fallback || key;
  };
  
  if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(eventType)) {
    limitations.push(translate(
      "verification.limits.strictSandbox", 
      { eventType }, 
      `Strict sandbox 限制：${eventType} 事件在 Web Pixel strict sandbox 环境中不可用，需要通过订单 webhooks 获取`
    ));
    return limitations;
  }
  
  if (knownLimitations.length > 0) {
    const missingKnownFields = knownLimitations.filter(field => {
      if (!result.discrepancies) {
        if (result.status === "missing_params" || result.status === "failed") {
          return true;
        }
        return false;
      }
      return result.discrepancies.some(d => 
        d.toLowerCase().includes(field.toLowerCase()) && 
        (d.includes("missing") || d.includes("null") || d.includes("undefined") || d.includes("缺少"))
      );
    });
    
    if (missingKnownFields.length > 0) {
      limitations.push(translate(
        "verification.limits.missingKnownFields",
        { eventType, fields: missingKnownFields.join(", ") },
        `Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中无法获取以下字段：${missingKnownFields.join(", ")}。这是平台限制，不是故障。`
      ));
    } else if (result.status === "missing_params" || result.status === "failed") {
      limitations.push(translate(
        "verification.limits.potentialMissingKnownFields",
        { eventType, fields: knownLimitations.join(", ") },
        `Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中可能无法获取以下字段（可能为 null）：${knownLimitations.join(", ")}。这是平台限制，不是故障。`
      ));
    } else {
      limitations.push(translate(
        "verification.limits.nullFields",
        { eventType, fields: knownLimitations.join(", ") },
        `Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中以下字段可能为 null（这是平台限制，不是故障）：${knownLimitations.join(", ")}。已自动标注。`
      ));
    }
  }
  
  if (result.status === "missing_params" && result.discrepancies) {
    const missingFields = result.discrepancies.filter(d => 
      d.includes("missing") || d.includes("null") || d.includes("undefined") || d.includes("缺少")
    );
    if (missingFields.length > 0) {
      const fieldNames = missingFields.map(d => {
        const match = d.match(/(?:missing|null|undefined|缺少)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i);
        return match ? match[1] : d;
      }).filter(f => f.length > 0);
      
      const knownFields = fieldNames.filter(f => knownLimitations.some(kl => f.includes(kl) || kl.includes(f)));
      const unknownFields = fieldNames.filter(f => !knownFields.includes(f));
      
      if (unknownFields.length > 0) {
        limitations.push(translate(
          "verification.limits.unavailableFields",
          { fields: unknownFields.join(", ") },
          `Strict sandbox 限制：以下字段在 Web Worker 环境中不可用：${unknownFields.join(", ")}`
        ));
      }
    }
  }
  
  if (result.eventType === "checkout_completed" || result.eventType === "checkout_started") {
    if (!result.params?.value && result.status !== "success") {
      limitations.push(translate(
        "verification.limits.incompleteValue",
        {},
        "Strict sandbox 限制：某些 checkout 事件在 Web Worker 环境中可能无法获取完整的 value 字段"
      ));
    }
  }
  
  return Array.from(new Set(limitations)); // Deduplicate
}
