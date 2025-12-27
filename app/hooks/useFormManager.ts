

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useNavigation } from "@remix-run/react";

export interface FieldConfig<T> {

  initialValue: T;

  validate?: (value: T, allValues: Record<string, unknown>) => string | undefined;

  required?: boolean;

  transform?: (value: T) => T;
}

export type FormConfig<T extends Record<string, unknown>> = {
  [K in keyof T]: FieldConfig<T[K]>;
};

export interface FieldState<T> {
  value: T;
  isDirty: boolean;
  error?: string;
  touched: boolean;
}

export interface FormState<T extends Record<string, unknown>> {
  values: T;
  isDirty: boolean;
  isValid: boolean;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
}

export interface FieldSetter<T> {
  (value: T): void;
  (updater: (prev: T) => T): void;
}

export interface FormManagerReturn<T extends Record<string, unknown>> {

  state: FormState<T>;

  values: T;

  isDirty: boolean;

  isValid: boolean;

  isSubmitting: boolean;

  setValue: <K extends keyof T>(field: K, value: T[K]) => void;

  setValues: (values: Partial<T>) => void;

  getValue: <K extends keyof T>(field: K) => T[K];

  getFieldState: <K extends keyof T>(field: K) => FieldState<T[K]>;

  touchField: (field: keyof T) => void;

  reset: () => void;

  resetWith: (newInitialValues: Partial<T>) => void;

  commit: () => void;

  validate: () => boolean;

  getError: (field: keyof T) => string | undefined;

  toFormData: (action?: string) => FormData;

  getFieldProps: <K extends keyof T>(field: K) => {
    value: T[K];
    onChange: (value: T[K]) => void;
    error: string | undefined;
    onBlur: () => void;
  };
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => isEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      isEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
    );
  }

  return false;
}

export function useFormManager<T extends Record<string, unknown>>(
  config: FormConfig<T>
): FormManagerReturn<T> {

  const initialValues = useMemo(() => {
    const values = {} as T;
    for (const key in config) {
      values[key] = config[key].initialValue;
    }
    return values;
  }, [config]);

  const initialValuesRef = useRef<T>(initialValues);

  const [values, setValuesState] = useState<T>(initialValues);

  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const errors = useMemo(() => {
    const result: Partial<Record<keyof T, string>> = {};

    for (const key in config) {
      const fieldConfig = config[key];
      const value = values[key];

      if (fieldConfig.required) {
        if (value === undefined || value === null || value === "") {
          result[key] = `${String(key)} is required`;
          continue;
        }
      }

      if (fieldConfig.validate) {
        const error = fieldConfig.validate(value, values as Record<string, unknown>);
        if (error) {
          result[key] = error;
        }
      }
    }

    return result;
  }, [config, values]);

  const [savedInitialValues, setSavedInitialValues] = useState<T>(initialValues);

  const isDirty = useMemo(() => {
    for (const key in values) {
      const fieldConfig = config[key];
      const currentValue = fieldConfig?.transform
        ? fieldConfig.transform(values[key])
        : values[key];
      const initialValue = fieldConfig?.transform
        ? fieldConfig.transform(savedInitialValues[key])
        : savedInitialValues[key];

      if (!isEqual(currentValue, initialValue)) {
        return true;
      }
    }
    return false;
  }, [config, values, savedInitialValues]);

  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const setValues = useCallback((newValues: Partial<T>) => {
    setValuesState((prev) => ({
      ...prev,
      ...newValues,
    }));
  }, []);

  const getValue = useCallback(
    <K extends keyof T>(field: K): T[K] => values[field],
    [values]
  );

  const getFieldState = useCallback(
    <K extends keyof T>(field: K): FieldState<T[K]> => {
      const fieldConfig = config[field];
      const currentValue = fieldConfig?.transform
        ? fieldConfig.transform(values[field])
        : values[field];
      const initialValue = fieldConfig?.transform
        ? fieldConfig.transform(savedInitialValues[field])
        : savedInitialValues[field];

      return {
        value: values[field],
        isDirty: !isEqual(currentValue, initialValue),
        error: errors[field],
        touched: touched[field] ?? false,
      };
    },
    [config, values, savedInitialValues, errors, touched]
  );

  const touchField = useCallback((field: keyof T) => {
    setTouched((prev) => ({
      ...prev,
      [field]: true,
    }));
  }, []);

  const reset = useCallback(() => {
    setValuesState(initialValuesRef.current);
    setTouched({});
  }, []);

  const resetWith = useCallback((newInitialValues: Partial<T>) => {
    const merged = { ...savedInitialValues, ...newInitialValues };
    initialValuesRef.current = merged;
    setSavedInitialValues(merged);
    setValuesState(merged);
    setTouched({});
  }, [savedInitialValues]);

  const commit = useCallback(() => {
    initialValuesRef.current = { ...values };
    setSavedInitialValues({ ...values });
    setTouched({});
  }, [values]);

  const validate = useCallback(() => {

    const allTouched: Partial<Record<keyof T, boolean>> = {};
    for (const key in config) {
      allTouched[key] = true;
    }
    setTouched(allTouched);

    return Object.keys(errors).length === 0;
  }, [config, errors]);

  const getError = useCallback(
    (field: keyof T) => (touched[field] ? errors[field] : undefined),
    [errors, touched]
  );

  const toFormData = useCallback(
    (action?: string): FormData => {
      const formData = new FormData();

      if (action) {
        formData.append("_action", action);
      }

      for (const key in values) {
        const value = values[key];
        if (value !== undefined && value !== null) {
          if (typeof value === "boolean") {
            formData.append(key, value.toString());
          } else if (typeof value === "object") {
            formData.append(key, JSON.stringify(value));
          } else {
            formData.append(key, String(value));
          }
        }
      }

      return formData;
    },
    [values]
  );

  const getFieldProps = useCallback(
    <K extends keyof T>(field: K) => ({
      value: values[field],
      onChange: (value: T[K]) => setValue(field, value),
      error: touched[field] ? errors[field] : undefined,
      onBlur: () => touchField(field),
    }),
    [values, errors, touched, setValue, touchField]
  );

  const state: FormState<T> = {
    values,
    isDirty,
    isValid,
    errors,
    touched,
  };

  return {
    state,
    values,
    isDirty,
    isValid,
    isSubmitting,
    setValue,
    setValues,
    getValue,
    getFieldState,
    touchField,
    reset,
    resetWith,
    commit,
    validate,
    getError,
    toFormData,
    getFieldProps,
  };
}

export function useField<T>(
  initialValue: T,
  validate?: (value: T) => string | undefined
) {
  const [value, setValue] = useState<T>(initialValue);
  const [touched, setTouched] = useState(false);

  const [savedInitial, setSavedInitial] = useState<T>(initialValue);
  const initialRef = useRef(initialValue);

  const error = useMemo(() => {
    if (!validate) return undefined;
    return validate(value);
  }, [value, validate]);

  const isDirty = useMemo(() => !isEqual(value, savedInitial), [value, savedInitial]);

  const reset = useCallback(() => {
    setValue(initialRef.current);
    setTouched(false);
  }, []);

  const resetWith = useCallback((newValue: T) => {
    initialRef.current = newValue;
    setSavedInitial(newValue);
    setValue(newValue);
    setTouched(false);
  }, []);

  return {
    value,
    setValue,
    isDirty,
    touched,
    touch: () => setTouched(true),
    error: touched ? error : undefined,
    reset,
    resetWith,
  };
}

export function useFormAfterAction<T extends Record<string, unknown>>(
  form: FormManagerReturn<T>,
  actionData: { success?: boolean } | undefined | null
) {
  const prevSuccessRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {

    if (actionData?.success && prevSuccessRef.current !== true) {
      form.commit();
    }
    prevSuccessRef.current = actionData?.success;
  }, [actionData?.success, form]);
}

export type FormValues<C> = C extends FormConfig<infer T> ? T : never;

export function field<T>(initialValue: T): FieldConfig<T> {
  return { initialValue };
}

export function requiredField<T>(
  initialValue: T,
  validate?: (value: T) => string | undefined
): FieldConfig<T> {
  return { initialValue, required: true, validate };
}

