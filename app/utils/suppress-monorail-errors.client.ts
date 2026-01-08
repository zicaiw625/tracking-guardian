/**
 * 在开发环境中抑制 Shopify monorail 遥测服务和 OpenTelemetry 相关的连接错误
 * 这些错误不影响应用功能，但在开发环境中会产生大量控制台噪音
 * 
 * 注意：这些错误来自：
 * 1. Shopify App Bridge 的遥测服务（monorail），在本地开发时无法连接到 Shopify 的内部服务
 * 2. 第三方库（如 OpenTelemetry SDK）尝试发送遥测数据到未配置的端点（produce/produce_batch）
 * 这些都是正常现象，不影响应用功能。
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
  
  // 检查是否是遥测相关的错误（monorail 或 OpenTelemetry）
  const isTelemetryError = (args: unknown[]): boolean => {
    const errorMessage = args.map(arg => 
      typeof arg === "string" ? arg : 
      arg instanceof Error ? arg.message : 
      String(arg)
    ).join(" ");
    
    return (
      errorMessage.includes("monorail-edge.shopifysvc.com") ||
      errorMessage.includes("monorail") ||
      errorMessage.includes("produce") ||
      errorMessage.includes("produce_batch") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("Failed to load resource") ||
      errorMessage.includes("opentelemetry") ||
      errorMessage.includes("otlp")
    );
  };
  
  // 拦截 console.error 调用
  console.error = (...args: unknown[]) => {
    if (isTelemetryError(args)) {
      return; // 静默处理遥测相关错误
    }
    originalConsoleError.apply(console, args);
  };

  // 拦截 console.warn 调用（某些浏览器可能使用 warn 而不是 error）
  console.warn = (...args: unknown[]) => {
    if (isTelemetryError(args)) {
      return; // 静默处理遥测相关警告
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
      errorMessage.includes("produce") ||
      errorMessage.includes("produce_batch") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("opentelemetry") ||
      errorMessage.includes("otlp")
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
      errorMessage.includes("produce") ||
      errorMessage.includes("produce_batch") ||
      errorMessage.includes("ERR_CONNECTION_REFUSED") ||
      errorMessage.includes("Failed to fetch") ||
      errorMessage.includes("opentelemetry") ||
      errorMessage.includes("otlp")
    ) {
      event.preventDefault();
      return false;
    }
  };
  
  window.addEventListener("unhandledrejection", rejectionHandler);

  // 拦截 fetch 请求失败（用于抑制网络面板中的错误显示）
  // 注意：这不会阻止网络请求，只是静默处理失败的错误
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    const isTelemetryRequest = 
      url.includes("produce") ||
      url.includes("produce_batch") ||
      url.includes("monorail") ||
      url.includes("opentelemetry") ||
      url.includes("otlp");
    
    try {
      const response = await originalFetch(...args);
      
      // 如果请求失败且是遥测相关请求，静默处理
      if (isTelemetryRequest && !response.ok) {
        // 返回一个模拟的成功响应，避免错误传播
        return new Response(null, { 
          status: 200, 
          statusText: "OK",
        });
      }
      
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 如果是遥测相关的请求失败，静默处理
      if (
        isTelemetryRequest ||
        errorMessage.includes("ERR_CONNECTION_REFUSED")
      ) {
        // 返回一个模拟的成功响应，避免错误传播
        return new Response(null, { 
          status: 200, 
          statusText: "OK",
        });
      }
      
      throw error;
    }
  };

  // 返回清理函数（可选，用于测试）
  return () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    window.fetch = originalFetch;
    window.removeEventListener("error", errorHandler, true);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}
