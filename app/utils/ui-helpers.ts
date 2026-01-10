export function formatNumber(num: number | string, decimals = 0): string {
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "0";
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export function formatPercent(value: number, decimals = 1): string {
  if (isNaN(value)) return "0%";
  return `${value.toFixed(decimals)}%`;
}

export function formatCurrency(
  amount: number | string,
  currency = "USD",
  decimals = 2
): string {
  const amt = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(amt)) return "0.00";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amt);
}

export function formatDateTime(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const d = typeof date === "string" || typeof date === "number"
    ? new Date(date)
    : date;
  if (isNaN(d.getTime())) return "无效日期";
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };
  return new Intl.DateTimeFormat("zh-CN", defaultOptions).format(d);
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = typeof date === "string" || typeof date === "number"
    ? new Date(date)
    : date;
  if (isNaN(d.getTime())) return "无效日期";
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return "刚刚";
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return formatDateTime(d, { year: "numeric", month: "short", day: "numeric" });
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

export function getStatusTone(
  status: string
): "success" | "critical" | "warning" | "info" | "attention" {
  const statusLower = status.toLowerCase();
  if (statusLower.includes("success") || statusLower.includes("完成") || statusLower.includes("成功")) {
    return "success";
  }
  if (statusLower.includes("error") || statusLower.includes("失败") || statusLower.includes("错误")) {
    return "critical";
  }
  if (statusLower.includes("warning") || statusLower.includes("警告") || statusLower.includes("风险")) {
    return "warning";
  }
  if (statusLower.includes("pending") || statusLower.includes("等待") || statusLower.includes("处理中")) {
    return "attention";
  }
  return "info";
}

export function getRiskTone(score: number): "success" | "warning" | "critical" {
  if (score >= 70) return "critical";
  if (score >= 40) return "warning";
  return "success";
}

export function calculateProgress(current: number, total: number): number {
  if (total === 0) return 0;
  const progress = (current / total) * 100;
  return Math.max(0, Math.min(100, progress));
}

export function generateId(prefix = "id"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    return success;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    return false;
  }
}

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
}

export function isTabletDevice(): boolean {
  if (typeof window === "undefined") return false;
  const width = window.innerWidth;
  return width >= 768 && width < 1024;
}

export function getResponsiveColumns(
  mobile: number = 1,
  tablet: number = 2,
  desktop: number = 3
): number {
  if (typeof window === "undefined") return desktop;
  const width = window.innerWidth;
  if (width < 768) return mobile;
  if (width < 1024) return tablet;
  return desktop;
}
