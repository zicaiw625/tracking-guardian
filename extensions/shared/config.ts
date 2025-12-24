const BUILD_TIME_URL = "__BACKEND_URL_PLACEHOLDER__";

/**
 * P2-1: 解析后端 URL
 * 
 * ⚠️ 注意：如果 BUILD_TIME_URL 仍是占位符，说明构建时未正确注入 SHOPIFY_APP_URL。
 * 生产环境必须通过 `npm run ext:inject` 注入正确的 URL。
 * 
 * Fallback 到生产 URL 仅用于开发/测试，正式部署时 CI 会强制检查。
 */
function resolveBackendUrl(): string {
  if (BUILD_TIME_URL && !BUILD_TIME_URL.includes("PLACEHOLDER")) {
    return BUILD_TIME_URL;
  }
  
  // P2-1: 开发环境警告 - 此警告会在 pixel 加载时显示在浏览器控制台
  // 生产构建时，CI 会因为缺少 SHOPIFY_APP_URL 而失败（见 build-extensions.ts）
  console.warn(
    "[Tracking Guardian] ⚠️ BACKEND_URL 未在构建时注入，使用默认生产 URL。" +
    "如果这是本地开发，请设置 SHOPIFY_APP_URL 环境变量。" +
    "如果这是生产环境，请检查构建流程是否正确运行了 ext:inject。"
  );
  
  return "https://tracking-guardian.onrender.com";
}

export const BACKEND_URL = resolveBackendUrl();

export const ALLOWED_BACKEND_HOSTS = [
  "tracking-guardian.onrender.com",
  "tracking-guardian-staging.onrender.com",
] as const;

export const DEV_HOSTS = [
  "localhost",
  "127.0.0.1",
] as const;

export function isAllowedBackendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    
    return (
      ALLOWED_BACKEND_HOSTS.includes(host as typeof ALLOWED_BACKEND_HOSTS[number]) ||
      DEV_HOSTS.includes(host as typeof DEV_HOSTS[number])
    );
  } catch {
    return false;
  }
}
