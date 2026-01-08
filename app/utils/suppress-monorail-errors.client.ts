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

  // 检查是否是遥测相关的请求 URL
  const isTelemetryUrl = (url: string): boolean => {
    if (!url) return false;
    return (
      url.includes("produce") ||
      url.includes("produce_batch") ||
      url.includes("monorail") ||
      url.includes("opentelemetry") ||
      url.includes("otlp") ||
      url.includes("/events") && url.includes("monorail")
    );
  };

  // 拦截 fetch 请求 - 在发送前就阻止遥测请求
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
    
    // 如果是遥测相关请求，直接返回成功响应，不发送实际请求
    if (isTelemetryUrl(url)) {
      return Promise.resolve(new Response(null, { 
        status: 200, 
        statusText: "OK",
        headers: new Headers({ "Content-Type": "application/json" }),
      }));
    }
    
    try {
      const response = await originalFetch(...args);
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 如果错误信息包含遥测相关关键词，也返回成功响应
      if (
        errorMessage.includes("ERR_CONNECTION_REFUSED") ||
        errorMessage.includes("Failed to fetch") ||
        errorMessage.includes("NetworkError")
      ) {
        // 检查是否是遥测相关的错误（通过请求参数判断）
        const requestInfo = args[0];
        if (requestInfo && typeof requestInfo === "object" && "url" in requestInfo) {
          if (isTelemetryUrl((requestInfo as { url: string }).url)) {
            return Promise.resolve(new Response(null, { 
              status: 200, 
              statusText: "OK",
              headers: new Headers({ "Content-Type": "application/json" }),
            }));
          }
        }
      }
      
      throw error;
    }
  };

  // 拦截 XMLHttpRequest（某些库可能使用 XHR 而不是 fetch）
  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends OriginalXHR {
    private _url: string | null = null;
    private _isTelemetryRequest = false;

    open(method: string, url: string | URL, ...rest: unknown[]): void {
      this._url = typeof url === "string" ? url : url.toString();
      this._isTelemetryRequest = isTelemetryUrl(this._url);
      
      // 如果是遥测相关请求，不实际打开连接
      if (this._isTelemetryRequest) {
        // 调用父类 open 以初始化基本状态，但不连接
        try {
          super.open(method, "about:blank", ...rest);
        } catch {
          // 忽略错误
        }
        return;
      }
      
      return super.open(method, url, ...rest);
    }

    send(...args: unknown[]): void {
      // 如果是遥测相关请求，模拟成功响应而不实际发送
      if (this._isTelemetryRequest) {
        // 使用 Object.defineProperty 设置只读属性
        try {
          Object.defineProperty(this, "readyState", { 
            value: 4, 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "status", { 
            value: 200, 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "statusText", { 
            value: "OK", 
            writable: false, 
            configurable: true 
          });
          Object.defineProperty(this, "responseText", { 
            value: "{}", 
            writable: false, 
            configurable: true 
          });
          
          // 延迟触发事件，模拟异步行为
          setTimeout(() => {
            try {
              if (this.onreadystatechange) {
                this.onreadystatechange(new Event("readystatechange") as unknown as Event);
              }
              if (this.onload) {
                this.onload(new Event("load") as unknown as Event);
              }
            } catch {
              // 忽略事件处理错误
            }
          }, 0);
        } catch {
          // 如果设置属性失败，至少不发送请求
        }
        return;
      }
      
      return super.send(...args);
    }
  } as typeof XMLHttpRequest;

  // 返回清理函数（可选，用于测试）
  return () => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    window.fetch = originalFetch;
    window.XMLHttpRequest = OriginalXHR;
    window.removeEventListener("error", errorHandler, true);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}
