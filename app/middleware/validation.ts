/**
 * Validation Middleware
 *
 * BACKWARDS COMPATIBILITY LAYER
 * =============================
 * 
 * This file provides backwards compatibility for existing imports.
 * New code should import directly from the unified validation module:
 * 
 * RECOMMENDED:
 *   import { validateJsonBody, withValidation } from "~/utils/validation";
 * 
 * LEGACY (still works but not recommended):
 *   import { validateJsonBody, withValidation } from "~/middleware/validation";
 * 
 * Benefits of importing from ~/utils/validation:
 * - Single source of truth for all validation utilities
 * - Access to Result-based functions and traditional functions
 * - Better discoverability of all validation helpers
 * 
 * @see app/utils/validation/index.ts for the canonical implementation
 * @deprecated Prefer importing from "~/utils/validation" directly
 */

// Re-export from the unified validation module for backwards compatibility
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
