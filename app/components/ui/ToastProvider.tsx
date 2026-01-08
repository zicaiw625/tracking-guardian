import { createContext, useContext, ReactNode } from "react";
import { ToastContainer, useToast, type Toast } from "./Toast";

interface ToastContextType {
  showToast: (message: string, type?: "success" | "error" | "info" | "warning", duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {

    return {
      showToast: () => {},
      showSuccess: () => {},
      showError: () => {},
      showInfo: () => {},
      showWarning: () => {},
    };
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, showToast, dismissToast, showSuccess, showError, showInfo, showWarning } = useToast();

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo, showWarning }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
