
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
      `Strict sandbox limitation: the ${eventType} event is unavailable in the Web Pixel strict sandbox and must be obtained via order webhooks.`
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
        `Known strict sandbox limitation: the ${eventType} event cannot access these fields in the Web Worker environment: ${missingKnownFields.join(", ")}. This is a platform limitation, not a malfunction.`
      ));
    } else if (result.status === "missing_params" || result.status === "failed") {
      limitations.push(translate(
        "verification.limits.potentialMissingKnownFields",
        { eventType, fields: knownLimitations.join(", ") },
        `Known strict sandbox limitation: the ${eventType} event may not be able to access these fields (possibly null) in the Web Worker environment: ${knownLimitations.join(", ")}. This is a platform limitation, not a malfunction.`
      ));
    } else {
      limitations.push(translate(
        "verification.limits.nullFields",
        { eventType, fields: knownLimitations.join(", ") },
        `Known strict sandbox limitation: in the Web Worker environment, these fields for ${eventType} may be null (${knownLimitations.join(", ")}). This is a platform limitation, not a malfunction, and has been auto-annotated.`
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
          `Strict sandbox limitation: these fields are unavailable in the Web Worker environment: ${unknownFields.join(", ")}`
        ));
      }
    }
  }
  
  if (result.eventType === "checkout_completed" || result.eventType === "checkout_started") {
    if (!result.params?.value && result.status !== "success") {
      limitations.push(translate(
        "verification.limits.incompleteValue",
        {},
        "Strict sandbox limitation: some checkout events may not provide a complete value field in the Web Worker environment."
      ));
    }
  }
  
  return Array.from(new Set(limitations)); // Deduplicate
}
