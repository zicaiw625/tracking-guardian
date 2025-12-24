/**
 * Validation Middleware
 *
 * Re-exports from the unified validation module.
 * This file is kept for backward compatibility.
 *
 * @see app/utils/validation/index.ts for the canonical implementation
 */

// Re-export everything from the unified validation module
export {
  // Types
  type ValidationErrorDetail,
  type ValidatedHandler,
  type ValidationOptions,
  type ValidateResult,
  type ValidationResult,
  type ValidationError,

  // Core validation functions (Result-based)
  validateJsonBodyResult as validateJsonBody,
  validateFormDataResult as validateFormData,
  validateSearchParamsResult as validateSearchParams,
  validateParamsResult as validateParams,

  // Formatters
  zodErrorToAppError,
  formatZodErrors,
  getZodIssues,

  // Middleware
  withValidationMiddleware as withValidation,
  createValidationErrorResponse as validationErrorResponse,

  // Helpers
  require,
  requireNonEmpty,
  validateEmail,
  validateUrl,
  validateRange,
  validateShopDomain,
  validateOrderId,
} from "../utils/validation";
