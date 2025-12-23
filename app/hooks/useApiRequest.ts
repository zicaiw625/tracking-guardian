/**
 * API Request Hook
 *
 * Provides a consistent way to make API calls with loading, error, and success states.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "@remix-run/react";

// =============================================================================
// Types
// =============================================================================

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
}

export interface UseApiRequestOptions {
  /** Redirect on 401 error */
  redirectOnUnauthorized?: boolean;
  /** Success callback */
  onSuccess?: () => void;
  /** Error callback */
  onError?: (error: ApiError) => void;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for making API requests with built-in state management.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { execute, loading, error, data } = useApiRequest<MyData>();
 *
 *   const handleSubmit = async () => {
 *     const result = await execute('/api/endpoint', {
 *       method: 'POST',
 *       body: JSON.stringify({ key: 'value' }),
 *     });
 *
 *     if (result) {
 *       // Success
 *     }
 *   };
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <ErrorDisplay error={error} />;
 *
 *   return <div>{data?.someField}</div>;
 * }
 * ```
 */
export function useApiRequest<T = unknown>(options: UseApiRequestOptions = {}) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const navigate = useNavigate();

  const execute = useCallback(
    async (
      url: string,
      init?: RequestInit
    ): Promise<T | null> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
            ...init?.headers,
          },
          ...init,
        });

        // Handle 401 Unauthorized
        if (response.status === 401 && options.redirectOnUnauthorized !== false) {
          navigate("/auth/login");
          return null;
        }

        const json = (await response.json()) as ApiResponse<T>;

        if (!json.success) {
          const error: ApiError = {
            message: json.error || "请求失败",
            code: json.code,
            details: json.details,
          };

          setState({ data: null, loading: false, error });
          options.onError?.(error);
          return null;
        }

        const data = json.data as T;
        setState({ data, loading: false, error: null });
        options.onSuccess?.();
        return data;
      } catch (error) {
        const apiError: ApiError = {
          message: error instanceof Error ? error.message : "网络错误",
          code: "NETWORK_ERROR",
        };

        setState({ data: null, loading: false, error: apiError });
        options.onError?.(apiError);
        return null;
      }
    },
    [navigate, options]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    execute,
    reset,
    clearError,
  };
}

// =============================================================================
// Mutation Hook
// =============================================================================

export interface UseMutationOptions<TInput, TOutput> {
  /** API endpoint */
  url: string;
  /** HTTP method */
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Transform input before sending */
  transformInput?: (input: TInput) => unknown;
  /** Callbacks */
  onSuccess?: (data: TOutput) => void;
  onError?: (error: ApiError) => void;
}

/**
 * Hook for mutations (POST, PUT, DELETE) with optimistic updates support.
 *
 * @example
 * ```tsx
 * const { mutate, loading } = useMutation<CreateInput, CreateOutput>({
 *   url: '/api/resource',
 *   method: 'POST',
 *   onSuccess: () => toast.success('Created!'),
 * });
 *
 * <Button loading={loading} onClick={() => mutate({ name: 'Test' })}>
 *   Create
 * </Button>
 * ```
 */
export function useMutation<TInput = unknown, TOutput = unknown>(
  options: UseMutationOptions<TInput, TOutput>
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const navigate = useNavigate();

  const mutate = useCallback(
    async (input: TInput): Promise<TOutput | null> => {
      setLoading(true);
      setError(null);

      try {
        const body = options.transformInput
          ? options.transformInput(input)
          : input;

        const response = await fetch(options.url, {
          method: options.method || "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.status === 401) {
          navigate("/auth/login");
          return null;
        }

        const json = (await response.json()) as ApiResponse<TOutput>;

        if (!json.success) {
          const apiError: ApiError = {
            message: json.error || "操作失败",
            code: json.code,
            details: json.details,
          };
          setError(apiError);
          options.onError?.(apiError);
          return null;
        }

        const data = json.data as TOutput;
        options.onSuccess?.(data);
        return data;
      } catch (err) {
        const apiError: ApiError = {
          message: err instanceof Error ? err.message : "网络错误",
          code: "NETWORK_ERROR",
        };
        setError(apiError);
        options.onError?.(apiError);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [options, navigate]
  );

  return {
    mutate,
    loading,
    error,
    clearError: () => setError(null),
  };
}

// =============================================================================
// Query Hook
// =============================================================================

export interface UseQueryOptions<T> {
  /** Auto-fetch on mount */
  enabled?: boolean;
  /** Refetch interval in ms */
  refetchInterval?: number;
  /** Callbacks */
  onSuccess?: (data: T) => void;
  onError?: (error: ApiError) => void;
}

/**
 * Hook for fetching data with auto-refresh support.
 *
 * @example
 * ```tsx
 * const { data, loading, error, refetch } = useQuery<MyData>(
 *   '/api/data',
 *   { refetchInterval: 30000 }
 * );
 * ```
 */
export function useQuery<T>(
  url: string,
  options: UseQueryOptions<T> = {}
) {
  const { enabled = true, refetchInterval, onSuccess, onError } = options;

  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: enabled,
    error: null,
  });

  const navigate = useNavigate();

  const fetch_ = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(url);

      if (response.status === 401) {
        navigate("/auth/login");
        return;
      }

      const json = (await response.json()) as ApiResponse<T>;

      if (!json.success) {
        const error: ApiError = {
          message: json.error || "获取数据失败",
          code: json.code,
        };
        setState({ data: null, loading: false, error });
        onError?.(error);
        return;
      }

      const data = json.data as T;
      setState({ data, loading: false, error: null });
      onSuccess?.(data);
    } catch (err) {
      const error: ApiError = {
        message: err instanceof Error ? err.message : "网络错误",
        code: "NETWORK_ERROR",
      };
      setState({ data: null, loading: false, error });
      onError?.(error);
    }
  }, [url, navigate, onSuccess, onError]);

  // Auto-fetch on mount
  useState(() => {
    if (enabled) {
      fetch_();
    }
  });

  // Refetch interval
  useState(() => {
    if (refetchInterval && enabled) {
      const intervalId = setInterval(fetch_, refetchInterval);
      return () => clearInterval(intervalId);
    }
  });

  return {
    ...state,
    refetch: fetch_,
  };
}

