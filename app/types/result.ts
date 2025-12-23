/**
 * Unified Result Type System
 *
 * Provides a type-safe way to handle success and failure cases without exceptions.
 * Replaces scattered {success: boolean, error?: Error} patterns throughout the codebase.
 *
 * @example
 * ```typescript
 * // Returning a Result
 * function divide(a: number, b: number): Result<number, AppError> {
 *   if (b === 0) {
 *     return err(new AppError("VALIDATION_ERROR", "Cannot divide by zero"));
 *   }
 *   return ok(a / b);
 * }
 *
 * // Using a Result
 * const result = divide(10, 2);
 * if (result.ok) {
 *   console.log(result.value); // 5
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */

import type { AppError } from "../utils/errors/app-error";

// =============================================================================
// Core Result Types
// =============================================================================

/**
 * Success variant of Result
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/**
 * Failure variant of Result
 */
export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Result type - represents either success (Ok) or failure (Err)
 *
 * @template T - The type of the success value
 * @template E - The type of the error (defaults to AppError)
 */
export type Result<T, E = AppError> = Ok<T> | Err<E>;

/**
 * Async Result - a Promise that resolves to a Result
 */
export type AsyncResult<T, E = AppError> = Promise<Result<T, E>>;

// =============================================================================
// Result Constructors
// =============================================================================

/**
 * Create a success Result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Create a failure Result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a Result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

/**
 * Check if a Result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

// =============================================================================
// Result Utilities
// =============================================================================

/**
 * Unwrap a Result, throwing if it's an error
 * Use sparingly - prefer pattern matching with if/else
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap a Result with a default value for errors
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.ok) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Unwrap a Result with a default value computed lazily
 */
export function unwrapOrElse<T, E>(
  result: Result<T, E>,
  defaultFn: (error: E) => T
): T {
  if (result.ok) {
    return result.value;
  }
  return defaultFn(result.error);
}

/**
 * Map the success value of a Result
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map the error of a Result
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  if (result.ok) {
    return result;
  }
  return err(fn(result.error));
}

/**
 * Flat map (chain) a Result
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

/**
 * Combine multiple Results into a single Result
 * If all are Ok, returns Ok with array of values
 * If any is Err, returns the first Err
 */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Combine multiple Results, collecting all errors
 */
export function combineAll<T, E>(results: Result<T, E>[]): Result<T[], E[]> {
  const values: T[] = [];
  const errors: E[] = [];

  for (const result of results) {
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(result.error);
    }
  }

  if (errors.length > 0) {
    return err(errors);
  }
  return ok(values);
}

// =============================================================================
// Async Utilities
// =============================================================================

/**
 * Wrap a promise that might throw into a Result
 */
export async function fromPromise<T, E = Error>(
  promise: Promise<T>,
  errorMapper?: (error: unknown) => E
): AsyncResult<T, E> {
  try {
    const value = await promise;
    return ok(value);
  } catch (error) {
    if (errorMapper) {
      return err(errorMapper(error));
    }
    return err(error as E);
  }
}

/**
 * Wrap a function that might throw into a Result
 */
export function fromThrowable<T, E = Error>(
  fn: () => T,
  errorMapper?: (error: unknown) => E
): Result<T, E> {
  try {
    const value = fn();
    return ok(value);
  } catch (error) {
    if (errorMapper) {
      return err(errorMapper(error));
    }
    return err(error as E);
  }
}

/**
 * Map async over a Result
 */
export async function mapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<U>
): AsyncResult<U, E> {
  if (result.ok) {
    return ok(await fn(result.value));
  }
  return result;
}

/**
 * Flat map async over a Result
 */
export async function flatMapAsync<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => AsyncResult<U, E>
): AsyncResult<U, E> {
  if (result.ok) {
    return fn(result.value);
  }
  return result;
}

// =============================================================================
// Match / Pattern Matching
// =============================================================================

/**
 * Pattern match on a Result
 *
 * @example
 * ```typescript
 * const result = divide(10, 2);
 * const message = match(result, {
 *   ok: (value) => `Result: ${value}`,
 *   err: (error) => `Error: ${error.message}`,
 * });
 * ```
 */
export function match<T, E, R>(
  result: Result<T, E>,
  handlers: {
    ok: (value: T) => R;
    err: (error: E) => R;
  }
): R {
  if (result.ok) {
    return handlers.ok(result.value);
  }
  return handlers.err(result.error);
}

/**
 * Tap into a Result without changing it (for logging, etc)
 */
export function tap<T, E>(
  result: Result<T, E>,
  fn: (value: T) => void
): Result<T, E> {
  if (result.ok) {
    fn(result.value);
  }
  return result;
}

/**
 * Tap into a Result's error without changing it
 */
export function tapErr<T, E>(
  result: Result<T, E>,
  fn: (error: E) => void
): Result<T, E> {
  if (!result.ok) {
    fn(result.error);
  }
  return result;
}

// =============================================================================
// Type Aliases for Common Patterns
// =============================================================================

/**
 * Result that returns nothing on success
 */
export type VoidResult<E = AppError> = Result<void, E>;

/**
 * Async Result that returns nothing on success
 */
export type AsyncVoidResult<E = AppError> = AsyncResult<void, E>;

/**
 * Result with a string error message (for simple cases)
 */
export type SimpleResult<T> = Result<T, string>;

/**
 * Result for operations that return an ID on success
 */
export type IdResult<E = AppError> = Result<string, E>;

