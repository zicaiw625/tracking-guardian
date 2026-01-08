import { useState, useCallback, useRef, useEffect } from 'react';

export interface UseFormDirtyOptions<T> {

  initialValues: T;

  comparator?: (a: T, b: T) => boolean;
}

export interface UseFormDirtyReturn<T> {

  isDirty: boolean;

  resetToClean: (newInitialValues?: T) => void;

  markDirty: () => void;

  markClean: () => void;

  getInitialValues: () => T;

  checkDirty: (currentValues: T) => boolean;
}

function defaultComparator<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useFormDirty<T>({
  initialValues,
  comparator = defaultComparator,
}: UseFormDirtyOptions<T>): UseFormDirtyReturn<T> {
  const [isDirty, setIsDirty] = useState(false);
  const initialValuesRef = useRef<T>(initialValues);

  useEffect(() => {
    initialValuesRef.current = initialValues;

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

export function useMultiFieldDirty<T extends Record<string, unknown>>(
  initialValues: T
) {
  const [values, setValues] = useState<T>(initialValues);
  const initialRef = useRef<T>(initialValues);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    initialRef.current = initialValues;

    setValues(initialValues);

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
