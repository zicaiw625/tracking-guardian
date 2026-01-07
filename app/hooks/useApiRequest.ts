

import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@remix-run/react";

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

  redirectOnUnauthorized?: boolean;

  onSuccess?: () => void;

  onError?: (error: ApiError) => void;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: Array<{ field: string; message: string }>;
}

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

export interface UseMutationOptions<TInput, TOutput> {

  url: string;

  method?: "POST" | "PUT" | "PATCH" | "DELETE";

  transformInput?: (input: TInput) => unknown;

  onSuccess?: (data: TOutput) => void;
  onError?: (error: ApiError) => void;
}

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

export interface UseQueryOptions<T> {

  enabled?: boolean;

  refetchInterval?: number;

  onSuccess?: (data: T) => void;
  onError?: (error: ApiError) => void;
}

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

  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

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
        onErrorRef.current?.(error);
        return;
      }

      const data = json.data as T;
      setState({ data, loading: false, error: null });
      onSuccessRef.current?.(data);
    } catch (err) {
      const error: ApiError = {
        message: err instanceof Error ? err.message : "网络错误",
        code: "NETWORK_ERROR",
      };
      setState({ data: null, loading: false, error });
      onErrorRef.current?.(error);
    }
  }, [url, navigate]);

  useEffect(() => {
    if (enabled) {
      fetch_();
    }
  }, [enabled, fetch_]);

  useEffect(() => {
    if (refetchInterval && enabled) {
      const intervalId = setInterval(fetch_, refetchInterval);
      return () => clearInterval(intervalId);
    }
  }, [refetchInterval, enabled, fetch_]);

  return {
    ...state,
    refetch: fetch_,
  };
}

