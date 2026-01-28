import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useToastContext } from "~/components/ui";
import type { RealtimeEvent } from "../RealtimeEventMonitor";

export interface UseRealtimeEventsOptions {
  shopId: string;
  platforms?: string[];
  autoStart?: boolean;
  runId?: string;
  eventTypes?: string[];
  useVerificationEndpoint?: boolean;
}

export interface UseRealtimeEventsReturn {
  events: RealtimeEvent[];
  setEvents: React.Dispatch<React.SetStateAction<RealtimeEvent[]>>;
  isConnected: boolean;
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>;
  isPaused: boolean;
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  connect: () => void;
  disconnect: () => void;
  handlePauseToggle: () => void;
  handleClear: () => void;
}

export function useRealtimeEvents({
  shopId,
  platforms = [],
  autoStart = false,
  runId,
  eventTypes = [],
  useVerificationEndpoint = false,
}: UseRealtimeEventsOptions): UseRealtimeEventsReturn {
  const { showError } = useToastContext();
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isPausedRef = useRef(isPaused);
  const showErrorRef = useRef(showError);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isReconnectingRef = useRef(false);
  const disconnectRef = useRef<(() => void) | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  useEffect(() => {
    if (!autoStart) {
      return;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    isReconnectingRef.current = false;
    const getReconnectDelay = (attempts: number): number => {
      const baseDelay = 1000;
      const maxDelay = 30000;
      const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
      const jitter = Math.random() * 0.3 * delay;
      return delay + jitter;
    };
    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      try {
        const endpoint = useVerificationEndpoint ? "/api/verification-events" : "/api/realtime-events";
        const params = new URLSearchParams({
          shopId,
          ...(platforms.length > 0 && { platforms: platforms.join(",") }),
          ...(eventTypes.length > 0 && { eventTypes: eventTypes.join(",") }),
          ...(runId && { runId }),
        });
        const eventSource = new EventSource(`${endpoint}?${params.toString()}`);
        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
          reconnectAttemptsRef.current = 0;
          isReconnectingRef.current = false;
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };
        eventSource.onmessage = (event) => {
          if (isPausedRef.current) return;
          try {
            const rawData = JSON.parse(event.data);
            if (useVerificationEndpoint && rawData.type) {
              if (rawData.type === "connected" || rawData.type === "error" || rawData.type === "verification_run_status") {
                return;
              }
              const { type: _type, ...eventData } = rawData;
              const data = eventData as unknown as RealtimeEvent;
              if (typeof data.timestamp === "string") {
                data.timestamp = new Date(data.timestamp);
              }
              setEvents((prev) => {
                const eventKey = data.id || `${data.timestamp}_${data.orderId || ""}`;
                const existingIndex = prev.findIndex(e =>
                  e.id === eventKey ||
                  (e.timestamp === data.timestamp && e.orderId === data.orderId)
                );
                if (existingIndex >= 0) {
                  const updated = [...prev];
                  updated[existingIndex] = data;
                  return updated.slice(0, 200);
                }
                return [data, ...prev].slice(0, 200);
              });
            } else {
              const data = rawData as RealtimeEvent;
              if (typeof data.timestamp === "string") {
                data.timestamp = new Date(data.timestamp);
              }
              setEvents((prev) => {
                const eventKey = data.id || `${data.timestamp}_${data.orderId || ""}`;
                const existingIndex = prev.findIndex(e =>
                  e.id === eventKey ||
                  (e.timestamp === data.timestamp && e.orderId === data.orderId)
                );
                if (existingIndex >= 0) {
                  const updated = [...prev];
                  updated[existingIndex] = data;
                  return updated.slice(0, 200);
                }
                return [data, ...prev].slice(0, 200);
              });
            }
          } catch (err) {
            import("../../../utils/debug-log.client").then(({ debugError }) => {
              debugError("Failed to parse event data:", err);
            });
          }
        };
        eventSource.onerror = (err) => {
          import("../../../utils/debug-log.client").then(({ debugError }) => {
            debugError("SSE error:", err);
          });
          setIsConnected(false);
          if (eventSource.readyState === EventSource.CLOSED && !isReconnectingRef.current) {
            isReconnectingRef.current = true;
            reconnectAttemptsRef.current += 1;
            const delay = getReconnectDelay(reconnectAttemptsRef.current);
            setError(`连接中断，${Math.round(delay / 1000)}秒后自动重连...`);
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
            }
            reconnectTimeoutRef.current = setTimeout(() => {
              if (eventSourceRef.current === eventSource) {
                eventSourceRef.current = null;
              }
              eventSource.close();
              isReconnectingRef.current = false;
              connect();
            }, delay);
          }
        };
        eventSourceRef.current = eventSource;
      } catch (err) {
        setError("无法建立连接");
        showErrorRef.current("无法建立实时监控连接");
        import("../../../utils/debug-log.client").then(({ debugError }) => {
          debugError("SSE connection error:", err);
        });
        reconnectAttemptsRef.current += 1;
        const delay = getReconnectDelay(reconnectAttemptsRef.current);
        isReconnectingRef.current = true;
        reconnectTimeoutRef.current = setTimeout(() => {
          isReconnectingRef.current = false;
          connect();
        }, delay);
      }
    };
    const disconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        try {
          eventSourceRef.current.close();
        } catch (error) {
          import("../../../utils/debug-log.client").then(({ debugWarn }) => {
            debugWarn("Error closing EventSource:", error);
          });
        }
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      setError(null);
      reconnectAttemptsRef.current = 0;
      isReconnectingRef.current = false;
    };
    disconnectRef.current = disconnect;
    connectRef.current = connect;
    connect();
    return () => {
      disconnect();
      disconnectRef.current = null;
      connectRef.current = null;
    };
  }, [autoStart, shopId, platforms, runId, eventTypes, useVerificationEndpoint]);

  const connect = useCallback(() => {
    if (connectRef.current) {
      connectRef.current();
    }
  }, []);

  const disconnect = useCallback(() => {
    if (disconnectRef.current) {
      disconnectRef.current();
    }
  }, []);

  const handlePauseToggle = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const handleClear = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    setEvents,
    isConnected,
    setIsConnected,
    isPaused,
    setIsPaused,
    error,
    setError,
    connect,
    disconnect,
    handlePauseToggle,
    handleClear,
  };
}
