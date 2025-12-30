
/**
 * 检测是否是开发商店（dev store）
 */
export function isDevStore(shopDomain: string): boolean {
  if (!shopDomain) return false;
  
  // 检查是否是 .myshopify.dev 域名
  if (shopDomain.includes(".myshopify.dev")) {
    return true;
  }
  
  // 检查是否包含 dev/staging/test 标识
  if (/-(dev|staging|test)\./i.test(shopDomain)) {
    return true;
  }
  
  return false;
}

/**
 * 生成模块预览 URL
 * @param shopDomain 店铺域名
 * @param moduleKey 模块键
 * @param target 目标页面类型
 * @returns 预览 URL 或 null（如果不是 dev store）
 */
export function generateModulePreviewUrl(
  shopDomain: string,
  moduleKey: string,
  target: "thank_you" | "order_status"
): string | null {
  if (!isDevStore(shopDomain)) {
    return null;
  }
  
  const baseUrl = `https://${shopDomain}`;
  
  if (target === "thank_you") {
    // Thank You 页面：通过测试结账流程查看
    return `${baseUrl}/checkout/test`;
  }
  
  if (target === "order_status") {
    // Order Status 页面：需要先有订单
    // 返回订单状态页面的基础 URL，用户需要先创建测试订单
    return `${baseUrl}/account/orders`;
  }
  
  return null;
}

