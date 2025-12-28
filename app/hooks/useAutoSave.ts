/**
 * 自动保存 Hook
 * 用于表单自动保存功能
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

export interface AutoSaveOptions<T> {
  /** 保存函数 */
  saveFn: (data: T) => Promise<void> | void;
  /** 延迟时间（毫秒） */
  delay?: number;
  /** 是否启用自动保存 */
  enabled?: boolean;
  /** 数据是否已更改（用于判断是否需要保存） */
  isDirty?: boolean;
  /** 保存成功回调 */
  onSaveSuccess?: () => void;
  /** 保存失败回调 */
  onSaveError?: (error: Error) => void;
}

export interface AutoSaveResult {
  /** 是否正在保存 */
  isSaving: boolean;
  /** 最后保存时间 */
  lastSavedAt: Date | null;
  /** 手动触发保存 */
  save: () => Promise<void>;
  /** 保存状态 */
  saveStatus: "idle" | "saving" | "saved" | "error";
}

/**
 * 自动保存 Hook
 * 
 * @example
 * ```tsx
 * const { isSaving, lastSavedAt, save } = useAutoSave({
 *   saveFn: async (formData) => {
 *     await updateSettings(formData);
 *   },
 *   delay: 1000,
 *   enabled: true,
 *   isDirty: formData !== initialData,
 * });
 * ```
 */
export function useAutoSave<T>({
  saveFn,
  delay = 1000,
  enabled = true,
  isDirty = true,
  onSaveSuccess,
  onSaveError,
}: AutoSaveOptions<T>): AutoSaveResult {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  
  const dataRef = useRef<T | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const performSave = useCallback(async (data: T) => {
    if (!enabled || !isDirty) return;

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      await saveFn(data);
      setLastSavedAt(new Date());
      setSaveStatus("saved");
      onSaveSuccess?.();
      
      // 3秒后重置状态为 idle
      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (error) {
      setSaveStatus("error");
      onSaveError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsSaving(false);
    }
  }, [enabled, isDirty, saveFn, onSaveSuccess, onSaveError]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const save = useCallback(async () => {
    if (dataRef.current !== null) {
      await performSave(dataRef.current);
    }
  }, [performSave]);

  // 设置数据并触发自动保存
  const setData = useCallback((data: T) => {
    dataRef.current = data;

    if (!enabled || !isDirty) return;

    // 清除之前的定时器
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // 设置新的定时器
    timeoutRef.current = setTimeout(() => {
      performSave(data);
    }, delay);
  }, [enabled, isDirty, delay, performSave]);

  return {
    isSaving,
    lastSavedAt,
    save,
    saveStatus,
    // 导出 setData 供外部使用（如果需要）
    setData: setData as unknown as (data: T) => void,
  } as AutoSaveResult & { setData: (data: T) => void };
}

