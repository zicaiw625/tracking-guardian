/**
 * useFormState Hook
 *
 * A hook for managing form state with dirty tracking.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

export interface FormStateOptions<T> {
  /**
   * Callback when dirty state changes
   */
  onDirtyChange?: (isDirty: boolean) => void;

  /**
   * Custom equality check function
   */
  isEqual?: (a: T, b: T) => boolean;
}

export interface FormStateReturn<T extends Record<string, unknown>> {
  /**
   * Current form values
   */
  values: T;

  /**
   * Set a single field value
   */
  setField: <K extends keyof T>(field: K, value: T[K]) => void;

  /**
   * Set multiple field values at once
   */
  setFields: (updates: Partial<T>) => void;

  /**
   * Replace all values
   */
  setValues: (values: T) => void;

  /**
   * Whether the form has unsaved changes
   */
  isDirty: boolean;

  /**
   * Reset form to initial values
   */
  reset: () => void;

  /**
   * Reset form to new initial values
   */
  resetTo: (newInitialValues: T) => void;

  /**
   * Commit current values as new initial values
   */
  commit: () => void;

  /**
   * Get initial values
   */
  initialValues: T;
}

// =============================================================================
// Default Equality Check
// =============================================================================

function defaultIsEqual<T>(a: T, b: T): boolean {
  // Handle primitives
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Handle objects (shallow comparison)
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

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing form state with dirty tracking.
 *
 * @example
 * ```tsx
 * const { values, setField, isDirty, reset, commit } = useFormState({
 *   email: "",
 *   name: "",
 * });
 *
 * return (
 *   <form onSubmit={(e) => {
 *     e.preventDefault();
 *     saveData(values);
 *     commit(); // Mark as saved
 *   }}>
 *     <TextField
 *       value={values.email}
 *       onChange={(v) => setField("email", v)}
 *     />
 *     {isDirty && <Button onClick={reset}>Discard</Button>}
 *   </form>
 * );
 * ```
 */
export function useFormState<T extends Record<string, unknown>>(
  initialValues: T,
  options: FormStateOptions<T> = {}
): FormStateReturn<T> {
  const { onDirtyChange, isEqual = defaultIsEqual } = options;

  // Store initial values in a ref to avoid recreating them on every render
  const initialValuesRef = useRef<T>(initialValues);
  const [values, setValuesInternal] = useState<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);

  // Track dirty state
  useEffect(() => {
    const dirty = !isEqual(values, initialValuesRef.current);
    if (dirty !== isDirty) {
      setIsDirty(dirty);
      onDirtyChange?.(dirty);
    }
  }, [values, isDirty, isEqual, onDirtyChange]);

  // Set a single field
  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValuesInternal((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    []
  );

  // Set multiple fields
  const setFields = useCallback((updates: Partial<T>) => {
    setValuesInternal((prev) => ({
      ...prev,
      ...updates,
    }));
  }, []);

  // Replace all values
  const setValues = useCallback((newValues: T) => {
    setValuesInternal(newValues);
  }, []);

  // Reset to initial values
  const reset = useCallback(() => {
    setValuesInternal(initialValuesRef.current);
  }, []);

  // Reset to new initial values
  const resetTo = useCallback((newInitialValues: T) => {
    initialValuesRef.current = newInitialValues;
    setValuesInternal(newInitialValues);
  }, []);

  // Commit current values as new initial values
  const commit = useCallback(() => {
    initialValuesRef.current = values;
    setIsDirty(false);
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
    initialValues: initialValuesRef.current,
  };
}

export default useFormState;

