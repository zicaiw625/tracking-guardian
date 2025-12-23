/**
 * Universal Form Manager Hook
 *
 * A generic, type-safe hook for managing form state with features:
 * - Automatic dirty tracking
 * - Initial values management
 * - Form reset functionality
 * - Contextual save bar integration
 * - Validation support
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useNavigation } from "@remix-run/react";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for a single form field
 */
export interface FieldConfig<T> {
  /** Initial value for the field */
  initialValue: T;
  /** Optional validation function */
  validate?: (value: T, allValues: Record<string, unknown>) => string | undefined;
  /** Whether field is required */
  required?: boolean;
  /** Field-level transform before comparison */
  transform?: (value: T) => T;
}

/**
 * Configuration object for all form fields
 */
export type FormConfig<T extends Record<string, unknown>> = {
  [K in keyof T]: FieldConfig<T[K]>;
};

/**
 * Individual field state
 */
export interface FieldState<T> {
  value: T;
  isDirty: boolean;
  error?: string;
  touched: boolean;
}

/**
 * Form manager state
 */
export interface FormState<T extends Record<string, unknown>> {
  values: T;
  isDirty: boolean;
  isValid: boolean;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
}

/**
 * Field setter with additional metadata
 */
export interface FieldSetter<T> {
  (value: T): void;
  (updater: (prev: T) => T): void;
}

/**
 * Return type for the useFormManager hook
 */
export interface FormManagerReturn<T extends Record<string, unknown>> {
  /** Current form state */
  state: FormState<T>;
  /** All field values */
  values: T;
  /** Whether form has unsaved changes */
  isDirty: boolean;
  /** Whether form is valid */
  isValid: boolean;
  /** Whether form is currently submitting */
  isSubmitting: boolean;
  /** Set a field value */
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Set multiple field values at once */
  setValues: (values: Partial<T>) => void;
  /** Get current value of a field */
  getValue: <K extends keyof T>(field: K) => T[K];
  /** Get field-specific state */
  getFieldState: <K extends keyof T>(field: K) => FieldState<T[K]>;
  /** Mark field as touched */
  touchField: (field: keyof T) => void;
  /** Reset form to initial values */
  reset: () => void;
  /** Reset form with new initial values */
  resetWith: (newInitialValues: Partial<T>) => void;
  /** Commit current values as new initial values */
  commit: () => void;
  /** Validate all fields and return whether form is valid */
  validate: () => boolean;
  /** Get error for a specific field */
  getError: (field: keyof T) => string | undefined;
  /** Build FormData from current values */
  toFormData: (action?: string) => FormData;
  /** Get field props for integration with Polaris or other UI */
  getFieldProps: <K extends keyof T>(field: K) => {
    value: T[K];
    onChange: (value: T[K]) => void;
    error: string | undefined;
    onBlur: () => void;
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Deep equality check for primitive values and arrays/objects
 */
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

// =============================================================================
// Main Hook
// =============================================================================

/**
 * Universal form manager hook
 *
 * @example
 * ```tsx
 * const form = useFormManager({
 *   email: { initialValue: "", required: true, validate: (v) => v.includes("@") ? undefined : "Invalid email" },
 *   name: { initialValue: "" },
 *   enabled: { initialValue: true },
 * });
 *
 * return (
 *   <form>
 *     <TextField {...form.getFieldProps("email")} label="Email" />
 *     <TextField {...form.getFieldProps("name")} label="Name" />
 *     <Checkbox checked={form.values.enabled} onChange={(v) => form.setValue("enabled", v)} />
 *
 *     {form.isDirty && <ContextualSaveBar onSave={handleSave} onDiscard={form.reset} />}
 *   </form>
 * );
 * ```
 */
export function useFormManager<T extends Record<string, unknown>>(
  config: FormConfig<T>
): FormManagerReturn<T> {
  // Extract initial values from config
  const initialValues = useMemo(() => {
    const values = {} as T;
    for (const key in config) {
      values[key] = config[key].initialValue;
    }
    return values;
  }, [config]);

  // Store initial values reference (for reset)
  const initialValuesRef = useRef<T>(initialValues);

  // Current values state
  const [values, setValuesState] = useState<T>(initialValues);

  // Touched fields tracking
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  // Navigation state for submit detection
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Calculate errors based on current values
  const errors = useMemo(() => {
    const result: Partial<Record<keyof T, string>> = {};

    for (const key in config) {
      const fieldConfig = config[key];
      const value = values[key];

      // Check required
      if (fieldConfig.required) {
        if (value === undefined || value === null || value === "") {
          result[key] = `${String(key)} is required`;
          continue;
        }
      }

      // Run custom validation
      if (fieldConfig.validate) {
        const error = fieldConfig.validate(value, values as Record<string, unknown>);
        if (error) {
          result[key] = error;
        }
      }
    }

    return result;
  }, [config, values]);

  // Calculate if form is dirty (any value differs from initial)
  const isDirty = useMemo(() => {
    for (const key in values) {
      const fieldConfig = config[key];
      const currentValue = fieldConfig?.transform
        ? fieldConfig.transform(values[key])
        : values[key];
      const initialValue = fieldConfig?.transform
        ? fieldConfig.transform(initialValuesRef.current[key])
        : initialValuesRef.current[key];

      if (!isEqual(currentValue, initialValue)) {
        return true;
      }
    }
    return false;
  }, [config, values]);

  // Calculate if form is valid
  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  // Set a single field value
  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState((prev) => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  // Set multiple values at once
  const setValues = useCallback((newValues: Partial<T>) => {
    setValuesState((prev) => ({
      ...prev,
      ...newValues,
    }));
  }, []);

  // Get a single field value
  const getValue = useCallback(
    <K extends keyof T>(field: K): T[K] => values[field],
    [values]
  );

  // Get field-specific state
  const getFieldState = useCallback(
    <K extends keyof T>(field: K): FieldState<T[K]> => {
      const fieldConfig = config[field];
      const currentValue = fieldConfig?.transform
        ? fieldConfig.transform(values[field])
        : values[field];
      const initialValue = fieldConfig?.transform
        ? fieldConfig.transform(initialValuesRef.current[field])
        : initialValuesRef.current[field];

      return {
        value: values[field],
        isDirty: !isEqual(currentValue, initialValue),
        error: errors[field],
        touched: touched[field] ?? false,
      };
    },
    [config, values, errors, touched]
  );

  // Mark field as touched
  const touchField = useCallback((field: keyof T) => {
    setTouched((prev) => ({
      ...prev,
      [field]: true,
    }));
  }, []);

  // Reset to initial values
  const reset = useCallback(() => {
    setValuesState(initialValuesRef.current);
    setTouched({});
  }, []);

  // Reset with new initial values
  const resetWith = useCallback((newInitialValues: Partial<T>) => {
    const merged = { ...initialValuesRef.current, ...newInitialValues };
    initialValuesRef.current = merged;
    setValuesState(merged);
    setTouched({});
  }, []);

  // Commit current values as new initial values
  const commit = useCallback(() => {
    initialValuesRef.current = { ...values };
    setTouched({});
  }, [values]);

  // Validate all fields
  const validate = useCallback(() => {
    // Touch all fields
    const allTouched: Partial<Record<keyof T, boolean>> = {};
    for (const key in config) {
      allTouched[key] = true;
    }
    setTouched(allTouched);

    return Object.keys(errors).length === 0;
  }, [config, errors]);

  // Get error for specific field
  const getError = useCallback(
    (field: keyof T) => (touched[field] ? errors[field] : undefined),
    [errors, touched]
  );

  // Build FormData from current values
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

  // Get field props for UI integration
  const getFieldProps = useCallback(
    <K extends keyof T>(field: K) => ({
      value: values[field],
      onChange: (value: T[K]) => setValue(field, value),
      error: touched[field] ? errors[field] : undefined,
      onBlur: () => touchField(field),
    }),
    [values, errors, touched, setValue, touchField]
  );

  // Construct form state object
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

// =============================================================================
// Specialized Hooks
// =============================================================================

/**
 * Simple hook for tracking a single form field
 */
export function useField<T>(
  initialValue: T,
  validate?: (value: T) => string | undefined
) {
  const [value, setValue] = useState<T>(initialValue);
  const [touched, setTouched] = useState(false);
  const initialRef = useRef(initialValue);

  const error = useMemo(() => {
    if (!validate) return undefined;
    return validate(value);
  }, [value, validate]);

  const isDirty = useMemo(() => !isEqual(value, initialRef.current), [value]);

  const reset = useCallback(() => {
    setValue(initialRef.current);
    setTouched(false);
  }, []);

  const resetWith = useCallback((newValue: T) => {
    initialRef.current = newValue;
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

/**
 * Hook for managing form state after action completion
 */
export function useFormAfterAction<T extends Record<string, unknown>>(
  form: FormManagerReturn<T>,
  actionData: { success?: boolean } | undefined | null
) {
  const prevSuccessRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    // Only commit if this is a new success (not on re-render)
    if (actionData?.success && prevSuccessRef.current !== true) {
      form.commit();
    }
    prevSuccessRef.current = actionData?.success;
  }, [actionData?.success, form]);
}

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extract the values type from a form config
 */
export type FormValues<C> = C extends FormConfig<infer T> ? T : never;

/**
 * Create a simple field config from a value
 */
export function field<T>(initialValue: T): FieldConfig<T> {
  return { initialValue };
}

/**
 * Create a required field config
 */
export function requiredField<T>(
  initialValue: T,
  validate?: (value: T) => string | undefined
): FieldConfig<T> {
  return { initialValue, required: true, validate };
}


