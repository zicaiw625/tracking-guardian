/**
 * P0-4: PCD 安全处理辅助函数
 * 
 * 用于安全访问 Protected Customer Data (PCD) 字段
 * v1.0 版本默认不收集任何 PII，此函数用于未来扩展
 * 
 * 使用方式：
 * 1. 在 Shopify Partner Dashboard 申请 PCD 权限
 * 2. 使用 safeBuyer() 安全访问 buyer 信息
 * 3. 提供降级方案（当 PCD 不可用时）
 * 
 * 参考：https://shopify.dev/docs/apps/store/data-protection/protected-customer-data
 */

/**
 * 检查是否可以访问 buyer 信息
 * 
 * @param api - UI Extension API 对象
 * @returns 是否可以访问 buyer 信息
 */
export function canUseBuyerInfo(api: unknown): boolean {
  // 检查 api 对象是否有 buyer 属性
  if (!api || typeof api !== "object") {
    return false;
  }

  // 检查是否有 buyer 属性
  if (!("buyer" in api)) {
    return false;
  }

  const buyer = (api as { buyer?: unknown }).buyer;
  
  // buyer 可能是 Promise 或对象
  if (buyer === null || buyer === undefined) {
    return false;
  }

  // 如果 buyer 是 Promise，需要等待解析
  // 这里只检查是否存在，不等待解析
  return true;
}

/**
 * 安全访问 buyer 信息
 * 
 * @param api - UI Extension API 对象
 * @returns buyer 信息（如果可用），否则返回 null
 */
export async function safeBuyer(
  api: unknown
): Promise<{
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: {
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
  };
  company?: string;
} | null> {
  if (!canUseBuyerInfo(api)) {
    return null;
  }

  try {
    const buyer = (api as { buyer?: unknown }).buyer;
    
    if (!buyer) {
      return null;
    }

    // 如果 buyer 是 Promise，等待解析
    const buyerData = buyer instanceof Promise ? await buyer : buyer;

    if (!buyerData || typeof buyerData !== "object") {
      return null;
    }

    const buyerObj = buyerData as Record<string, unknown>;

    // 安全提取字段（只提取明确需要的字段）
    return {
      email: typeof buyerObj.email === "string" ? buyerObj.email : undefined,
      phone: typeof buyerObj.phone === "string" ? buyerObj.phone : undefined,
      firstName: typeof buyerObj.firstName === "string" ? buyerObj.firstName : undefined,
      lastName: typeof buyerObj.lastName === "string" ? buyerObj.lastName : undefined,
      address: buyerObj.address && typeof buyerObj.address === "object"
        ? {
            address1: typeof (buyerObj.address as Record<string, unknown>).address1 === "string"
              ? (buyerObj.address as Record<string, unknown>).address1 as string
              : undefined,
            address2: typeof (buyerObj.address as Record<string, unknown>).address2 === "string"
              ? (buyerObj.address as Record<string, unknown>).address2 as string
              : undefined,
            city: typeof (buyerObj.address as Record<string, unknown>).city === "string"
              ? (buyerObj.address as Record<string, unknown>).city as string
              : undefined,
            province: typeof (buyerObj.address as Record<string, unknown>).province === "string"
              ? (buyerObj.address as Record<string, unknown>).province as string
              : undefined,
            zip: typeof (buyerObj.address as Record<string, unknown>).zip === "string"
              ? (buyerObj.address as Record<string, unknown>).zip as string
              : undefined,
            country: typeof (buyerObj.address as Record<string, unknown>).country === "string"
              ? (buyerObj.address as Record<string, unknown>).country as string
              : undefined,
          }
        : undefined,
      company: typeof buyerObj.company === "string" ? buyerObj.company : undefined,
    };
  } catch (error) {
    // 如果访问失败（可能是 PCD 权限未获批），返回 null
    console.warn("[safeBuyer] Failed to access buyer info:", error);
    return null;
  }
}
