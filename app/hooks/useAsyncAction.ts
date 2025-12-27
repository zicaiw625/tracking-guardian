/**
 * useAsyncAction Hook
 *
 * A hook for managing async actions with loading and error states.
 */

import { useState, useCallback, useRef, useEffect } from "react";

// =============================================================================
// Types
// =============================================================================

export interface AsyncActionState<T = unknown, E = Error> {
  /**
   * Whether the action is currently executing
   */
  isLoading: boolean;

  /**
   * The result of the last successful execution
   */
  data: T | null;

  /**
   * The error from the last failed execution
   */
  error: E | null;

  /**
   * Whether the action has been executed at least once
   */
  hasRun: boolean;
}

export interface AsyncActionOptions {
  /**
   * Called when action starts
   */
  onStart?: () => void;

  /**
   * Called when action succeeds
   */
  onSuccess?: <T>(data: T) => void;

  /**
   * Called when action fails
   */
  onError?: (error: Error) => void;

  /**
   * Called when action completes (success or error)
   */
  onFinally?: () => void;
}

export interface AsyncActionReturn<T, Args extends unknown[]> {
  /**
   * Execute the async action
   */
  execute: (...args: Args) => Promise<T | null>;

  /**
   * Current state of the action
   */
  state: AsyncActionState<T>;

  /**
   * Reset the state to initial values
   */
  reset: () => void;

  /**
   * Convenience accessors
   */
  isLoading: boolean;
  data: T | null;
  error: Error | null;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing async actions with loading and error states.
 *
 * @example
 * ```tsx
 * const { execute, isLoading, error } = useAsyncAction(
 *   async (userId: string) => {
 *     const response = await fetch(`/api/users/${userId}`);
 *     return response.json();
 *   },
 *   {
 *     onSuccess: (data) => console.log("User loaded:", data),
 *     onError: (error) => console.error("Failed:", error),
 *   }
 * );
 *
 * return (
 *   <Button onClick={() => execute("123")} loading={isLoading}>
 *     Load User
 *   </Button>
 * );
 * ```
 */
export function useAsyncAction<T, Args extends unknown[] = []>(
  action: (...args: Args) => Promise<T>,
  options: AsyncActionOptions = {}
): AsyncActionReturn<T, Args> {
  const { onStart, onSuccess, onError, onFinally } = options;

  const [state, setState] = useState<AsyncActionState<T>>({
    isLoading: false,
    data: null,
    error: null,
    hasRun: false,
  });

  // Use ref to track if component is mounted
  const mountedRef = useRef(true);

  // Cleanup on unmount to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      onStart?.();

      try {
        const result = await action(...args);

        if (mountedRef.current) {
          setState({
            isLoading: false,
            data: result,
            error: null,
            hasRun: true,
          });

          onSuccess?.(result);
        }

        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));

        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error,
            hasRun: true,
          }));

          onError?.(error);
        }

        return null;
      } finally {
        onFinally?.();
      }
    },
    [action, onStart, onSuccess, onError, onFinally]
  );

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      data: null,
      error: null,
      hasRun: false,
    });
  }, []);

  return {
    execute,
    state,
    reset,
    isLoading: state.isLoading,
    data: state.data,
    error: state.error,
  };
}

export default useAsyncAction;

