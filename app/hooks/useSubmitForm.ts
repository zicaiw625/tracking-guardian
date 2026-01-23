import { useCallback, useRef } from 'react';
import { useSubmit, useNavigation } from '@remix-run/react';

export type FormDataBuilder = Record<string, string | number | boolean | undefined | null>;

export interface UseSubmitFormOptions {
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  action?: string;
  replace?: boolean;
}

export interface UseSubmitFormReturn {
  isSubmitting: boolean;
  submitForm: (data: FormDataBuilder) => void;
  submitAction: (action: string, data?: FormDataBuilder) => void;
  submitRaw: (formData: FormData) => void;
  state: 'idle' | 'submitting' | 'loading';
}

function buildFormData(data: FormDataBuilder): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  }
  return formData;
}

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

export function useConfirmSubmit(options: {
  message?: string;
  submitOptions?: UseSubmitFormOptions;
  confirm?: (message: string) => boolean | Promise<boolean>;
} = {}) {
  const { message = 'Are you sure?', submitOptions, confirm } = options;
  const { submitAction, isSubmitting, state } = useSubmitForm(submitOptions);
  const confirmAndSubmit = useCallback(async (
    action: string,
    data?: FormDataBuilder,
    customMessage?: string
  ) => {
    const promptMessage = customMessage || message;
    const confirmed = confirm
      ? await Promise.resolve(confirm(promptMessage))
      : true;
    if (confirmed) {
      submitAction(action, data);
    }
    return confirmed;
  }, [submitAction, message, confirm]);
  return {
    confirmAndSubmit,
    isSubmitting,
    state,
  };
}

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
