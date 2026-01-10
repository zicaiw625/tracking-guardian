import { useState, useEffect, useCallback, useRef, useMemo } from "react";

export interface FormStateOptions<T> {
  onDirtyChange?: (isDirty: boolean) => void;
  isEqual?: (a: T, b: T) => boolean;
}

export interface FormStateReturn<T extends Record<string, unknown>> {
  values: T;
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  setFields: (updates: Partial<T>) => void;
  setValues: (values: T) => void;
  isDirty: boolean;
  reset: () => void;
  resetTo: (newInitialValues: T) => void;
  commit: () => void;
  initialValues: T;
}

function defaultIsEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => {
      const valA = (a as Record<string, unknown>)[key];
      const valB = (b as Record<string, unknown>)[key];
      return valA === valB;
    });
  }
  return false;
}

export function useFormState<T extends Record<string, unknown>>(
  initialValues: T,
  options: FormStateOptions<T> = {}
): FormStateReturn<T> {
  const { onDirtyChange, isEqual = defaultIsEqual } = options;
  const initialValuesRef = useRef<T>(initialValues);
  const [values, setValuesInternal] = useState<T>(initialValues);
  const [savedInitialValues, setSavedInitialValues] = useState<T>(initialValues);
  const isDirty = useMemo(
    () => !isEqual(values, savedInitialValues),
    [values, savedInitialValues, isEqual]
  );
  const prevIsDirtyRef = useRef(isDirty);
  useEffect(() => {
    if (prevIsDirtyRef.current !== isDirty) {
      prevIsDirtyRef.current = isDirty;
      onDirtyChange?.(isDirty);
    }
  }, [isDirty, onDirtyChange]);
  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValuesInternal((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );
  const setFields = useCallback((updates: Partial<T>) => {
    setValuesInternal((prev) => ({
      ...prev,
      ...updates,
    }));
  }, []);
  const setValues = useCallback((newValues: T) => {
    setValuesInternal(newValues);
  }, []);
  const reset = useCallback(() => {
    setValuesInternal(initialValuesRef.current);
  }, []);
  const resetTo = useCallback((newInitialValues: T) => {
    initialValuesRef.current = newInitialValues;
    setSavedInitialValues(newInitialValues);
    setValuesInternal(newInitialValues);
  }, []);
  const commit = useCallback(() => {
    initialValuesRef.current = values;
    setSavedInitialValues(values);
  }, [values]);
  return {
    values,
    setField,
    setFields,
    setValues,
    isDirty,
    reset,
    resetTo,
    commit,
    initialValues: savedInitialValues,
  };
}

export default useFormState;
