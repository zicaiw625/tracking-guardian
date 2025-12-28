/**
 * Toast 通知组件
 * 用于显示操作成功/失败的临时提示
 */

import { useCallback, useEffect, useState } from "react";
import { Banner, InlineStack, Icon, Text, Box, BlockStack } from "@shopify/polaris";
import { CheckCircleIcon, AlertCircleIcon, InfoIcon } from "../icons";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number; // 自动关闭时间（毫秒），0 表示不自动关闭
}

interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  const tone = toast.type === "success" ? "success" : 
               toast.type === "error" ? "critical" : 
               toast.type === "warning" ? "warning" : "info";

  const icon = toast.type === "success" ? CheckCircleIcon :
               toast.type === "error" ? AlertCircleIcon :
               InfoIcon;

  return (
    <div style={{ animation: "slideIn 0.3s ease-out" }}>
      <Box paddingBlockStart="200" paddingBlockEnd="200">
      <Banner
        tone={tone}
        onDismiss={() => onDismiss(toast.id)}
      >
        <InlineStack gap="200" blockAlign="center">
          <Icon source={icon} tone={tone} />
          <Text as="span">{toast.message}</Text>
        </InlineStack>
      </Banner>
      </Box>
    </div>
  );
}

export interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "60px",
        right: "20px",
        minWidth: "320px",
        maxWidth: "480px",
        zIndex: 1000,
      }}
    >
      <BlockStack gap="200">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </BlockStack>
    </div>
  );
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    message: string,
    type: ToastType = "info",
    duration: number = 3000
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback((message: string, duration?: number) => {
    showToast(message, "success", duration);
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    showToast(message, "error", duration || 5000); // 错误消息显示更久
  }, [showToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    showToast(message, "info", duration);
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    showToast(message, "warning", duration);
  }, [showToast]);

  return {
    toasts,
    showToast,
    dismissToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
  };
}

// CSS animation (should be added to global styles)
const toastStyles = `
@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
`;

// Export styles to be added to root stylesheet
export { toastStyles };

