/**
 * Custom Hooks Export
 * 
 * Centralized exports for all custom React hooks.
 */

// =============================================================================
// Universal Form Manager (NEW - Recommended)
// =============================================================================

export {
  useFormManager,
  useField,
  useFormAfterAction,
  field,
  requiredField,
  type FieldConfig,
  type FormConfig,
  type FieldState,
  type FormState,
  type FieldSetter,
  type FormManagerReturn,
  type FormValues,
} from './useFormManager';

// =============================================================================
// Legacy Form Hooks (Kept for backwards compatibility)
// =============================================================================

// Form dirty state tracking
export {
  useFormDirty,
  useMultiFieldDirty,
  type UseFormDirtyOptions,
  type UseFormDirtyReturn,
} from './useFormDirty';

// Form submission helpers
export {
  useSubmitForm,
  useConfirmSubmit,
  useDebouncedSubmit,
  type FormDataBuilder,
  type UseSubmitFormOptions,
  type UseSubmitFormReturn,
} from './useSubmitForm';

// Form state management
export {
  useFormState,
  type FormStateOptions,
  type FormStateReturn,
} from './useFormState';

// =============================================================================
// Async & Utility Hooks
// =============================================================================

// Async action management
export {
  useAsyncAction,
  type AsyncActionState,
  type AsyncActionOptions,
  type AsyncActionReturn,
} from './useAsyncAction';

// Debounce utilities
export {
  useDebounceValue,
  useDebounceCallback,
  useThrottle,
} from './useDebounce';
