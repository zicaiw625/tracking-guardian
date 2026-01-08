/**
 * 在开发环境中抑制 Shopify monorail 遥测服务的连接错误
 * 这些错误不影响应用功能，但在开发环境中会产生大量控制台噪音
 * 
 * 注意：这些错误来自 Shopify App Bridge 的遥测服务，在本地开发时
 * 无法连接到 Shopify 的内部服务，这是正常现象。
 */
export function suppressMonorailErrors() {
  if (typeof window === "undefined") return;
  
  // 只在开发环境中启用
  const isDev = 
    process.env.NODE_ENV === "development" || 
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes(".local");

  if (!isDev) return;

  // 保存原始的 console 方法
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // 检查是否是 monorail 相关的错误
  const isMonorailError = (args: unknown[]): boolean => {
    const errorMessage = args.map(arg => 
      typeof arg === "string" ? arg : 
      arg instanceof Error ? arg.message : 
      String(arg)
    ).join(" ");
    
    return (
      errorMessage.includes("monorail-edge.shopifysvc.com") ||
      errorMessage.includes("monorail") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("Failed to load resource")
    );
  };
  
  // 拦截 console.error 调用
  console.error = (...args: unknown[]) => {
    if (isMonorailError(args)) {
      return; // 静默处理 monorail 错误
    }
    originalConsoleError.apply(console, args);
  };

  // 拦截 console.warn 调用（某些浏览器可能使用 warn 而不是 error）
  console.warn = (...args: unknown[]) => {
    if (isMonorailError(args)) {
      return; // 静默处理 monorail 警告
    }
    originalConsoleWarn.apply(console, args);
  };

  // 拦截全局错误事件（捕获运行时错误）
  const errorHandler = (event: ErrorEvent) => {
    const errorMessage = event.message || "";
    const filename = event.filename || "";
    
    if (
      errorMessage.includes("monorail") ||
      filename.includes("monorail") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED")
    ) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  };
  
  window.addEventListener("error", errorHandler, true);

  // 监听未处理的 Promise 拒绝
  const rejectionHandler = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const errorMessage = 
      reason?.message || 
      reason?.toString() || 
      String(reason || "");
    
    if (
      errorMessage.includes("monorail") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("Failed to fetch")
    ) {
      event.preventDefault();
      return false;
    }
  };
  
  window.addEventListener("unhandledrejection", rejectionHandler);

  // 返回清理函数（可选，用于测试）
  return () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    window.removeEventListener("error", errorHandler, true);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}
