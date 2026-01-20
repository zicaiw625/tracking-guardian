export interface SafeFetchOptions {
  allowedDomains: string[];
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: HeadersInit;
}

export class SafeFetchError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export async function safeFetch(
  url: string | URL,
  options: SafeFetchOptions
): Promise<Response> {
  const urlObj = typeof url === "string" ? new URL(url) : url;
  
  if (urlObj.protocol !== "https:") {
    throw new SafeFetchError("Only HTTPS protocol is allowed", "INVALID_PROTOCOL");
  }
  
  const hostname = urlObj.hostname.toLowerCase();
  const isAllowed = options.allowedDomains.some(domain => {
    const normalizedDomain = domain.toLowerCase();
    return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
  });
  
  if (!isAllowed) {
    throw new SafeFetchError(`Domain ${hostname} is not in allowed list`, "DOMAIN_NOT_ALLOWED");
  }
  
  const privateIpPatterns = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
  ];
  
  if (privateIpPatterns.some(pattern => pattern.test(hostname))) {
    throw new SafeFetchError("Private IP addresses are not allowed", "PRIVATE_IP");
  }
  
  const timeoutMs = options.timeoutMs ?? 10000;
  const maxRedirects = options.maxRedirects ?? 0;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const fetchOptions: RequestInit = {
      ...options.headers && { headers: options.headers },
      redirect: maxRedirects > 0 ? "follow" : "manual",
      signal: controller.signal,
    };
    
    let response = await fetch(urlObj, fetchOptions);
    let redirectCount = 0;
    
    while (response.status >= 300 && response.status < 400 && redirectCount < maxRedirects) {
      const location = response.headers.get("Location");
      if (!location) {
        break;
      }
      
      const redirectUrl = new URL(location, urlObj);
      if (redirectUrl.protocol !== "https:") {
        throw new SafeFetchError("Redirect to non-HTTPS URL is not allowed", "INVALID_REDIRECT_PROTOCOL");
      }
      
      const redirectHostname = redirectUrl.hostname.toLowerCase();
      const isRedirectAllowed = options.allowedDomains.some(domain => {
        const normalizedDomain = domain.toLowerCase();
        return redirectHostname === normalizedDomain || redirectHostname.endsWith(`.${normalizedDomain}`);
      });
      
      if (!isRedirectAllowed) {
        throw new SafeFetchError(`Redirect domain ${redirectHostname} is not in allowed list`, "REDIRECT_DOMAIN_NOT_ALLOWED");
      }
      
      redirectCount++;
      response = await fetch(redirectUrl, fetchOptions);
    }
    
    return response;
  } catch (error) {
    if (error instanceof SafeFetchError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new SafeFetchError(`Request timeout after ${timeoutMs}ms`, "TIMEOUT");
    }
    throw new SafeFetchError(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`, "FETCH_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }
}
