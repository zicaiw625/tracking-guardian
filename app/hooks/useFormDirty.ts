/**
 * Form Dirty State Hook
 * 
 * Tracks whether a form has unsaved changes by comparing current values
 * against initial values.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Options for the useFormDirty hook.
 */
export interface UseFormDirtyOptions<T> {
  /**
   * Initial form values.
   */
  initialValues: T;
  
  /**
   * Optional custom comparator function.
   * Defaults to deep equality check.
   */
  comparator?: (a: T, b: T) => boolean;
}

/**
 * Return type for useFormDirty hook.
 */
export interface UseFormDirtyReturn<T> {
  /**
   * Whether the form has unsaved changes.
   */
  isDirty: boolean;
  
  /**
   * Update the comparison reference (e.g., after successful save).
   */
  resetToClean: (newInitialValues?: T) => void;
  
  /**
   * Mark the form as dirty manually.
   */
  markDirty: () => void;
  
  /**
   * Mark the form as clean manually.
   */
  markClean: () => void;
  
  /**
   * Get the initial values.
   */
  getInitialValues: () => T;
  
  /**
   * Check if current values differ from initial.
   */
  checkDirty: (currentValues: T) => boolean;
}

/**
 * Default deep equality comparator.
 */
function defaultComparator<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Hook to track form dirty state.
 * 
 * @example
 * ```tsx
 * const { isDirty, resetToClean, checkDirty } = useFormDirty({
 *   initialValues: { name: '', email: '' },
 * });
 * 
 * // Check dirty state when values change
 * useEffect(() => {
 *   checkDirty({ name, email });
 * }, [name, email]);
 * 
 * // Reset after save
 * const handleSave = async () => {
 *   await save();
 *   resetToClean({ name, email });
 * };
 * ```
 */
export function useFormDirty<T>({
  initialValues,
  comparator = defaultComparator,
}: UseFormDirtyOptions<T>): UseFormDirtyReturn<T> {
  const [isDirty, setIsDirty] = useState(false);
  const initialValuesRef = useRef<T>(initialValues);
  
  // Update ref when initialValues changes (e.g., from loader)
  // This is intentional: we want to reset dirty state when initial values change
  useEffect(() => {
    initialValuesRef.current = initialValues;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
    setIsDirty(false);
  }, [initialValues]);
  
  const checkDirty = useCallback((currentValues: T): boolean => {
    const dirty = !comparator(initialValuesRef.current, currentValues);
    setIsDirty(dirty);
    return dirty;
  }, [comparator]);
  
  const resetToClean = useCallback((newInitialValues?: T) => {
    if (newInitialValues !== undefined) {
      initialValuesRef.current = newInitialValues;
    }
    setIsDirty(false);
  }, []);
  
  const markDirty = useCallback(() => {
    setIsDirty(true);
  }, []);
  
  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);
  
  const getInitialValues = useCallback(() => {
    return initialValuesRef.current;
  }, []);
  
  return {
    isDirty,
    resetToClean,
    markDirty,
    markClean,
    getInitialValues,
    checkDirty,
  };
}

/**
 * Simplified hook for tracking multiple form fields.
 * 
 * @example
 * ```tsx
 * const { isDirty, updateField, resetAll, getValues } = useMultiFieldDirty({
 *   name: '',
 *   email: '',
 *   phone: '',
 * });
 * ```
 */
export function useMultiFieldDirty<T extends Record<string, unknown>>(
  initialValues: T
) {
  const [values, setValues] = useState<T>(initialValues);
  const initialRef = useRef<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);
  
  // Reset state when initialValues prop changes
  useEffect(() => {
    initialRef.current = initialValues;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
    setValues(initialValues);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset on prop change
    setIsDirty(false);
  }, [initialValues]);
  
  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValues(prev => {
      const newValues = { ...prev, [field]: value };
      const dirty = JSON.stringify(newValues) !== JSON.stringify(initialRef.current);
      setIsDirty(dirty);
      return newValues;
    });
  }, []);
  
  const resetAll = useCallback((newInitialValues?: T) => {
    if (newInitialValues) {
      initialRef.current = newInitialValues;
      setValues(newInitialValues);
    } else {
      setValues(initialRef.current);
    }
    setIsDirty(false);
  }, []);
  
  const getValues = useCallback(() => values, [values]);
  const getInitialValues = useCallback(() => initialRef.current, []);
  
  return {
    values,
    isDirty,
    updateField,
    resetAll,
    getValues,
    getInitialValues,
  };
}

