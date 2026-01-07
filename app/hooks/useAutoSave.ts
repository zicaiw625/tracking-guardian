

import { useEffect, useRef, useState, useCallback } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

export interface AutoSaveOptions<T> {

  saveFn: (data: T) => Promise<void> | void;

  delay?: number;

  enabled?: boolean;

  isDirty?: boolean;

  onSaveSuccess?: () => void;

  onSaveError?: (error: Error) => void;
}

export interface AutoSaveResult {

  isSaving: boolean;

  lastSavedAt: Date | null;

  save: () => Promise<void>;

  saveStatus: "idle" | "saving" | "saved" | "error";
}

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
  const statusResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const performSave = useCallback(async (data: T) => {
    if (!enabled || !isDirty) return;

    setIsSaving(true);
    setSaveStatus("saving");

    try {
      await saveFn(data);
      setLastSavedAt(new Date());
      setSaveStatus("saved");
      onSaveSuccess?.();

      if (statusResetTimeoutRef.current) {
        clearTimeout(statusResetTimeoutRef.current);
      }

      statusResetTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
        statusResetTimeoutRef.current = null;
      }, 3000);
    } catch (error) {
      setSaveStatus("error");
      onSaveError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setIsSaving(false);
    }
  }, [enabled, isDirty, saveFn, onSaveSuccess, onSaveError]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (statusResetTimeoutRef.current) {
        clearTimeout(statusResetTimeoutRef.current);
      }
    };
  }, []);

  const save = useCallback(async () => {
    if (dataRef.current !== null) {
      await performSave(dataRef.current);
    }
  }, [performSave]);

  const setData = useCallback((data: T) => {
    dataRef.current = data;

    if (!enabled || !isDirty) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      performSave(data);
    }, delay);
  }, [enabled, isDirty, delay, performSave]);

  return {
    isSaving,
    lastSavedAt,
    save,
    saveStatus,
    setData,
  } as AutoSaveResult & { setData: (data: T) => void };
}

