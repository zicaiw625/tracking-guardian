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
  
  // 开发环境允许 fallback 并提示；生产环境直接 fail-closed
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    console.warn(
      "[Tracking Guardian] ⚠️ BACKEND_URL 未在构建时注入，使用默认开发 URL。" +
      "请在本地设置 SHOPIFY_APP_URL 或运行 yarn ext:inject。"
    );
    return "https://tracking-guardian.onrender.com";
  }
  throw new Error(
    "[Tracking Guardian] BACKEND_URL 未在构建时注入，生产环境禁止 fallback。请检查构建流程是否运行了 ext:inject 并正确设置 SHOPIFY_APP_URL。"
  );
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
