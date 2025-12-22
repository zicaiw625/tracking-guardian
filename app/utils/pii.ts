import type { OrderWebhookPayload } from "../types";
export interface ExtractedPII {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
}
export function extractPIISafely(payload: OrderWebhookPayload | null | undefined, piiEnabled: boolean): ExtractedPII {
    if (!piiEnabled || !payload) {
        return {};
    }
    const normalize = (value: string | null | undefined): string | undefined => {
        if (value === null || value === undefined) {
            return undefined;
        }
        const trimmed = String(value).trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };
    const billingAddress = payload.billing_address || {};
    const customer = payload.customer || {};
    return {
        email: normalize(payload.email),
        phone: normalize(payload.phone) || normalize(billingAddress.phone),
        firstName: normalize(customer.first_name) || normalize(billingAddress.first_name),
        lastName: normalize(customer.last_name) || normalize(billingAddress.last_name),
        city: normalize(billingAddress.city),
        state: normalize(billingAddress.province),
        country: normalize(billingAddress.country_code),
        zip: normalize(billingAddress.zip),
    };
}
export function hasPII(pii: ExtractedPII): boolean {
    return !!(pii.email ||
        pii.phone ||
        pii.firstName ||
        pii.lastName ||
        pii.city ||
        pii.state ||
        pii.country ||
        pii.zip);
}
export function logPIIStatus(orderId: string, pii: ExtractedPII, piiEnabled: boolean): void {
    if (!piiEnabled) {
        console.log(`[PII] Order ${orderId}: PII disabled`);
        return;
    }
    const available: string[] = [];
    const missing: string[] = [];
    const fields = ["email", "phone", "firstName", "lastName", "city", "state", "country", "zip"] as const;
    for (const field of fields) {
        if (pii[field]) {
            available.push(field);
        }
        else {
            missing.push(field);
        }
    }
    if (available.length === 0) {
        console.log(`[PII] Order ${orderId}: No PII available. ` +
            `This may indicate Protected Customer Data access is not granted.`);
    }
    else {
        console.log(`[PII] Order ${orderId}: Available=[${available.join(",")}], Missing=[${missing.join(",")}]`);
    }
}
