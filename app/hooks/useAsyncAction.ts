

import { useState, useCallback, useRef, useEffect } from "react";

export interface AsyncActionState<T = unknown, E = Error> {

  isLoading: boolean;

  data: T | null;

  error: E | null;

  hasRun: boolean;
}

export interface AsyncActionOptions {

  onStart?: () => void;

  onSuccess?: <T>(data: T) => void;

  onError?: (error: Error) => void;

  onFinally?: () => void;
}

export interface AsyncActionReturn<T, Args extends unknown[]> {

  execute: (...args: Args) => Promise<T | null>;

  state: AsyncActionState<T>;

  reset: () => void;

  isLoading: boolean;
  data: T | null;
  error: Error | null;
}

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

  const mountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 清理未完成的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      // 取消之前的请求（如果存在）
      const previousController = abortControllerRef.current;
      if (previousController) {
        previousController.abort();
      }

      // 创建新的AbortController
      const abortController = new AbortController();
      const currentController = abortController;
      abortControllerRef.current = currentController;

      // 检查组件是否已卸载
      if (!mountedRef.current) {
        return null;
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
      }));

      onStart?.();

      try {
        const result = await action(...args);

        // 检查是否被取消或组件已卸载
        if (currentController.signal.aborted || !mountedRef.current) {
          return null;
        }

        // 再次检查是否仍然是当前控制器（防止竞态条件）
        if (abortControllerRef.current !== currentController) {
          return null;
        }

        setState({
          isLoading: false,
          data: result,
          error: null,
          hasRun: true,
        });

        onSuccess?.(result);

        return result;
      } catch (err) {
        // 如果请求被取消或组件已卸载，不更新状态
        if (currentController.signal.aborted || !mountedRef.current) {
          return null;
        }

        // 再次检查是否仍然是当前控制器（防止竞态条件）
        if (abortControllerRef.current !== currentController) {
          return null;
        }

        const error = err instanceof Error ? err : new Error(String(err));

        setState((prev) => ({
          ...prev,
          isLoading: false,
          error,
          hasRun: true,
        }));

        onError?.(error);

        return null;
      } finally {
        // 清理AbortController引用（仅当仍然是当前控制器时）
        if (abortControllerRef.current === currentController) {
          abortControllerRef.current = null;
        }
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

