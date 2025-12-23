/**
 * useDebounce Hook
 *
 * A hook for debouncing values or callbacks.
 */

import { useState, useEffect, useRef, useCallback } from "react";

// =============================================================================
// useDebounceValue Hook
// =============================================================================

/**
 * Debounce a value by delaying updates.
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState("");
 * const debouncedSearch = useDebounceValue(searchTerm, 300);
 *
 * useEffect(() => {
 *   // This only runs when debouncedSearch changes
 *   // (300ms after the user stops typing)
 *   fetchResults(debouncedSearch);
 * }, [debouncedSearch]);
 * ```
 */
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

// =============================================================================
// useDebounceCallback Hook
// =============================================================================

/**
 * Create a debounced version of a callback function.
 *
 * @example
 * ```tsx
 * const saveChanges = useDebounceCallback(
 *   (data: FormData) => {
 *     api.save(data);
 *   },
 *   500
 * );
 *
 * // This will only save 500ms after the last call
 * const handleChange = (data: FormData) => {
 *   saveChanges(data);
 * };
 * ```
 */
export function useDebounceCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update callback ref when callback changes
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
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

// =============================================================================
// useThrottle Hook
// =============================================================================

/**
 * Throttle a value to update at most once per interval.
 *
 * @example
 * ```tsx
 * const [scrollY, setScrollY] = useState(0);
 * const throttledScrollY = useThrottle(scrollY, 100);
 *
 * useEffect(() => {
 *   const handleScroll = () => setScrollY(window.scrollY);
 *   window.addEventListener("scroll", handleScroll);
 *   return () => window.removeEventListener("scroll", handleScroll);
 * }, []);
 * ```
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const lastUpdated = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdated.current;

    if (timeSinceLastUpdate >= interval) {
      lastUpdated.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(() => {
        lastUpdated.current = Date.now();
        setThrottledValue(value);
      }, interval - timeSinceLastUpdate);

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

export default useDebounceValue;

