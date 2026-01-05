import { logger } from "./logger.server";
// P0-6: v1.0 版本不包含任何 PCD/PII 处理，因此移除 OrderWebhookPayload 导入
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks

export interface GDPRDataRequestPayload {
    shop_id: number;
    shop_domain: string;
    orders_requested: number[];
    customer_id?: number;
    data_request_id?: number;
}

export interface GDPRCustomerRedactPayload {
    shop_id: number;
    shop_domain: string;
    customer_id?: number;
    orders_to_redact: number[];
}

export interface GDPRShopRedactPayload {
    shop_id: number;
    shop_domain: string;
}

export interface GDPRValidationResult<T> {
    valid: boolean;
    errors: string[];
    payload?: T;
}

export function parseGDPRDataRequestPayload(data: unknown, shopDomain: string): GDPRDataRequestPayload | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        logger.warn(`[GDPR] Invalid data_request payload from ${shopDomain}: not an object`);
        return null;
    }

    const raw = data as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof raw.shop_id !== "number") {
        errors.push("Missing or invalid 'shop_id'");
    }
    if (typeof raw.shop_domain !== "string") {
        errors.push("Missing or invalid 'shop_domain'");
    }

    if (errors.length > 0) {
        logger.warn(`[GDPR] Invalid data_request payload from ${shopDomain}`, { errors });
        return null;
    }

    const customer = raw.customer as Record<string, unknown> | undefined;
    const dataRequest = raw.data_request as Record<string, unknown> | undefined;

    return {
        shop_id: raw.shop_id as number,
        shop_domain: raw.shop_domain as string,
        orders_requested: Array.isArray(raw.orders_requested)
            ? raw.orders_requested.filter((id): id is number => typeof id === "number")
            : [],
        customer_id: typeof customer?.id === "number" ? customer.id : undefined,
        data_request_id: typeof dataRequest?.id === "number" ? dataRequest.id : undefined,
    };
}

export function parseGDPRCustomerRedactPayload(data: unknown, shopDomain: string): GDPRCustomerRedactPayload | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        logger.warn(`[GDPR] Invalid customer_redact payload from ${shopDomain}: not an object`);
        return null;
    }

    const raw = data as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof raw.shop_id !== "number") {
        errors.push("Missing or invalid 'shop_id'");
    }
    if (typeof raw.shop_domain !== "string") {
        errors.push("Missing or invalid 'shop_domain'");
    }

    if (errors.length > 0) {
        logger.warn(`[GDPR] Invalid customer_redact payload from ${shopDomain}`, { errors });
        return null;
    }

    const customer = raw.customer as Record<string, unknown> | undefined;

    return {
        shop_id: raw.shop_id as number,
        shop_domain: raw.shop_domain as string,
        customer_id: typeof customer?.id === "number" ? customer.id : undefined,
        orders_to_redact: Array.isArray(raw.orders_to_redact)
            ? raw.orders_to_redact.filter((id): id is number => typeof id === "number")
            : [],
    };
}

export function parseGDPRShopRedactPayload(data: unknown, shopDomain: string): GDPRShopRedactPayload | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        logger.warn(`[GDPR] Invalid shop_redact payload from ${shopDomain}: not an object`);
        return null;
    }

    const raw = data as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof raw.shop_id !== "number") {
        errors.push("Missing or invalid 'shop_id'");
    }
    if (typeof raw.shop_domain !== "string") {
        errors.push("Missing or invalid 'shop_domain'");
    }

    if (errors.length > 0) {
        logger.warn(`[GDPR] Invalid shop_redact payload from ${shopDomain}`, { errors });
        return null;
    }

    return {
        shop_id: raw.shop_id as number,
        shop_domain: raw.shop_domain as string,
    };
}

// P0-6: v1.0 版本不包含任何 PCD/PII 处理，因此移除所有 Order webhook 验证函数
// v1.0 仅依赖 Web Pixels 标准事件，不处理订单 webhooks
// 已移除：validateOrderWebhookPayload, parseOrderWebhookPayload 及其所有辅助函数（sanitizeString, sanitizeNumber, sanitizeShippingPriceSet, sanitizeCustomer, sanitizeBillingAddress, sanitizeLineItems）
