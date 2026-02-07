
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

export function getEventSandboxLimitations(result: VerificationEventResultLike): string[] {
  const limitations: string[] = [];
  const eventType = result.eventType;
  const knownLimitations = STRICT_SANDBOX_FIELD_LIMITATIONS[eventType] || [];
  
  if (STRICT_SANDBOX_UNAVAILABLE_EVENTS.includes(eventType)) {
    limitations.push(`Strict sandbox 限制：${eventType} 事件在 Web Pixel strict sandbox 环境中不可用，需要通过订单 webhooks 获取`);
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
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中无法获取以下字段：${missingKnownFields.join(", ")}。这是平台限制，不是故障。`);
    } else if (result.status === "missing_params" || result.status === "failed") {
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中可能无法获取以下字段（可能为 null）：${knownLimitations.join(", ")}。这是平台限制，不是故障。`);
    } else {
      // Logic for "success" but potentially null fields (not explicit failure) is usually handled by UI hints, but here we can add a note if needed.
      // In original code, it added a note for success too.
      limitations.push(`Strict sandbox 已知限制：${eventType} 事件在 Web Worker 环境中以下字段可能为 null（这是平台限制，不是故障）：${knownLimitations.join(", ")}。已自动标注。`);
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
      
      // Note: The original code logic for "knownFields" inside this block was slightly duplicative with above.
      // But we keep it to catch fields explicitly reported as missing in discrepancies.
      
      if (unknownFields.length > 0) {
        limitations.push(`Strict sandbox 限制：以下字段在 Web Worker 环境中不可用：${unknownFields.join(", ")}`);
      }
    }
  }
  
  if (result.eventType === "checkout_completed" || result.eventType === "checkout_started") {
    if (!result.params?.value && result.status !== "success") {
      limitations.push("Strict sandbox 限制：某些 checkout 事件在 Web Worker 环境中可能无法获取完整的 value 字段");
    }
  }
  
  return Array.from(new Set(limitations)); // Deduplicate
}
