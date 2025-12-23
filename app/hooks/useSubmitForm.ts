/**
 * Form Submit Hook
 * 
 * Provides a type-safe wrapper around Remix's useSubmit with common patterns.
 */

import { useCallback, useRef } from 'react';
import { useSubmit, useNavigation } from '@remix-run/react';

/**
 * Form data builder type.
 */
export type FormDataBuilder = Record<string, string | number | boolean | undefined | null>;

/**
 * Options for useSubmitForm hook.
 */
export interface UseSubmitFormOptions {
  /**
   * HTTP method to use.
   * @default 'post'
   */
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  
  /**
   * Target action URL.
   */
  action?: string;
  
  /**
   * Whether to replace history entry.
   */
  replace?: boolean;
}

/**
 * Return type for useSubmitForm hook.
 */
export interface UseSubmitFormReturn {
  /**
   * Whether a form submission is in progress.
   */
  isSubmitting: boolean;
  
  /**
   * Submit form data.
   */
  submitForm: (data: FormDataBuilder) => void;
  
  /**
   * Submit form with action key.
   */
  submitAction: (action: string, data?: FormDataBuilder) => void;
  
  /**
   * Submit raw FormData.
   */
  submitRaw: (formData: FormData) => void;
  
  /**
   * Navigation state from Remix.
   */
  state: 'idle' | 'submitting' | 'loading';
}

/**
 * Build FormData from object.
 */
function buildFormData(data: FormDataBuilder): FormData {
  const formData = new FormData();
  
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  }
  
  return formData;
}

/**
 * Hook for handling form submissions with Remix.
 * 
 * @example
 * ```tsx
 * const { isSubmitting, submitAction, submitForm } = useSubmitForm();
 * 
 * // Submit with action key
 * const handleSave = () => {
 *   submitAction('saveAlert', {
 *     channel: 'email',
 *     email: 'test@example.com',
 *     threshold: 10,
 *   });
 * };
 * 
 * // Or submit raw data
 * const handleCustom = () => {
 *   submitForm({
 *     _action: 'custom',
 *     value: 123,
 *   });
 * };
 * ```
 */
export function useSubmitForm(options: UseSubmitFormOptions = {}): UseSubmitFormReturn {
  const submit = useSubmit();
  const navigation = useNavigation();
  
  const { method = 'post', action, replace } = options;
  
  const isSubmitting = navigation.state === 'submitting';
  
  const submitRaw = useCallback((formData: FormData) => {
    submit(formData, {
      method,
      action,
      replace,
    });
  }, [submit, method, action, replace]);
  
  const submitForm = useCallback((data: FormDataBuilder) => {
    const formData = buildFormData(data);
    submitRaw(formData);
  }, [submitRaw]);
  
  const submitAction = useCallback((actionKey: string, data: FormDataBuilder = {}) => {
    const formData = buildFormData({
      _action: actionKey,
      ...data,
    });
    submitRaw(formData);
  }, [submitRaw]);
  
  return {
    isSubmitting,
    submitForm,
    submitAction,
    submitRaw,
    state: navigation.state,
  };
}

/**
 * Hook for confirmation dialogs before form submission.
 * 
 * @example
 * ```tsx
 * const { confirmAndSubmit } = useConfirmSubmit({
 *   message: 'Are you sure you want to delete this?',
 * });
 * 
 * const handleDelete = () => {
 *   confirmAndSubmit('delete', { id: '123' });
 * };
 * ```
 */
export function useConfirmSubmit(options: {
  message?: string;
  submitOptions?: UseSubmitFormOptions;
} = {}) {
  const { message = 'Are you sure?', submitOptions } = options;
  const { submitAction, isSubmitting, state } = useSubmitForm(submitOptions);
  
  const confirmAndSubmit = useCallback((
    action: string,
    data?: FormDataBuilder,
    customMessage?: string
  ) => {
    const confirmed = window.confirm(customMessage || message);
    if (confirmed) {
      submitAction(action, data);
    }
    return confirmed;
  }, [submitAction, message]);
  
  return {
    confirmAndSubmit,
    isSubmitting,
    state,
  };
}

/**
 * Hook for debounced form submission (useful for auto-save).
 * 
 * @example
 * ```tsx
 * const { debouncedSubmit, cancel } = useDebouncedSubmit({
 *   delay: 1000,
 * });
 * 
 * // Auto-save on change
 * useEffect(() => {
 *   debouncedSubmit('autoSave', { content: value });
 * }, [value]);
 * ```
 */
export function useDebouncedSubmit(options: {
  delay?: number;
  submitOptions?: UseSubmitFormOptions;
} = {}) {
  const { delay = 500, submitOptions } = options;
  const { submitAction, isSubmitting, state } = useSubmitForm(submitOptions);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const debouncedSubmit = useCallback((
    action: string,
    data?: FormDataBuilder
  ) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      submitAction(action, data);
    }, delay);
  }, [submitAction, delay]);
  
  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);
  
  return {
    debouncedSubmit,
    cancel,
    isSubmitting,
    state,
  };
}

