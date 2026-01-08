import { useState, useEffect, useRef, useCallback } from "react";

export function useDebounceValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useDebounceCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Args) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);

  const lastUpdated = useRef<number>(0);

  const pendingValue = useRef<T>(value);

  useEffect(() => {
    pendingValue.current = value;
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdated.current;

    const delay = lastUpdated.current === 0
      ? 0
      : Math.max(0, interval - timeSinceLastUpdate);

    const timer = setTimeout(() => {
      lastUpdated.current = Date.now();
      setThrottledValue(pendingValue.current);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, interval]);

  return throttledValue;
}

export default useDebounceValue;
