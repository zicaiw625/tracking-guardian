/**
 * Distributed Tracing Module
 * 
 * P3: Provides OpenTelemetry-style tracing for the application.
 * 
 * Features:
 * - Span creation and management
 * - Context propagation
 * - Automatic instrumentation helpers
 * - Export to external services (Sentry, Datadog, etc.)
 * 
 * This module is designed to be OpenTelemetry-compatible while being
 * lightweight for environments where full OTel is not needed.
 */

import { randomBytes } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "./logger.server";

// =============================================================================
// Types
// =============================================================================

/**
 * Span status
 */
export enum SpanStatus {
  UNSET = "unset",
  OK = "ok",
  ERROR = "error",
}

/**
 * Span kind (follows OpenTelemetry conventions)
 */
export enum SpanKind {
  INTERNAL = "internal",
  SERVER = "server",
  CLIENT = "client",
  PRODUCER = "producer",
  CONSUMER = "consumer",
}

/**
 * Span attributes (key-value pairs)
 */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Span event (a point-in-time occurrence during a span)
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

/**
 * Span link (reference to another span)
 */
export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: SpanAttributes;
}

/**
 * Span context for propagation
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

/**
 * Span representation
 */
export interface Span {
  /** Span name */
  name: string;
  /** Trace ID (shared across all spans in a trace) */
  traceId: string;
  /** Unique span ID */
  spanId: string;
  /** Parent span ID (if any) */
  parentSpanId?: string;
  /** Span kind */
  kind: SpanKind;
  /** Start time (ms since epoch) */
  startTime: number;
  /** End time (ms since epoch, set when span ends) */
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  /** Span status */
  status: SpanStatus;
  /** Status message (for errors) */
  statusMessage?: string;
  /** Span attributes */
  attributes: SpanAttributes;
  /** Span events */
  events: SpanEvent[];
  /** Span links */
  links: SpanLink[];
}

/**
 * Active span with methods
 */
export interface ActiveSpan extends Span {
  /** Set an attribute */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Set multiple attributes */
  setAttributes(attributes: SpanAttributes): void;
  /** Add an event */
  addEvent(name: string, attributes?: SpanAttributes): void;
  /** Set status */
  setStatus(status: SpanStatus, message?: string): void;
  /** Record an error */
  recordError(error: Error | unknown): void;
  /** End the span */
  end(): void;
  /** Get span context for propagation */
  getContext(): SpanContext;
}

/**
 * Span processor (called when spans end)
 */
export interface SpanProcessor {
  onStart(span: Span): void;
  onEnd(span: Span): void;
}

// =============================================================================
// ID Generation
// =============================================================================

/**
 * Generate a 128-bit trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Generate a 64-bit span ID (16 hex chars)
 */
function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

// =============================================================================
// Span Storage
// =============================================================================

interface TracingContext {
  currentSpan?: ActiveSpan;
  traceId: string;
}

const tracingStorage = new AsyncLocalStorage<TracingContext>();

// =============================================================================
// Span Processors
// =============================================================================

const spanProcessors: SpanProcessor[] = [];

/**
 * Register a span processor
 */
export function registerSpanProcessor(processor: SpanProcessor): void {
  spanProcessors.push(processor);
}

/**
 * Remove a span processor
 */
export function removeSpanProcessor(processor: SpanProcessor): void {
  const index = spanProcessors.indexOf(processor);
  if (index !== -1) {
    spanProcessors.splice(index, 1);
  }
}

// =============================================================================
// Default Logging Processor
// =============================================================================

/**
 * Default processor that logs spans (for development/debugging)
 */
const loggingProcessor: SpanProcessor = {
  onStart: () => {
    // No-op for logging processor
  },
  onEnd: (span) => {
    // Only log slow or errored spans by default
    const isSlowSpan = span.duration && span.duration > 1000;
    const isError = span.status === SpanStatus.ERROR;

    if (isSlowSpan || isError) {
      const level = isError ? "warn" : "info";
      logger.log(level, `[TRACE] ${span.name}`, {
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        kind: span.kind,
        duration: span.duration,
        status: span.status,
        statusMessage: span.statusMessage,
        ...span.attributes,
      });
    }
  },
};

// Register logging processor by default
spanProcessors.push(loggingProcessor);

// =============================================================================
// Span Creation
// =============================================================================

/**
 * Create an active span
 */
function createActiveSpan(
  name: string,
  kind: SpanKind,
  parentContext?: TracingContext
): ActiveSpan {
  const traceId = parentContext?.traceId || generateTraceId();
  const spanId = generateSpanId();
  const parentSpanId = parentContext?.currentSpan?.spanId;

  const span: Span = {
    name,
    traceId,
    spanId,
    parentSpanId,
    kind,
    startTime: Date.now(),
    status: SpanStatus.UNSET,
    attributes: {},
    events: [],
    links: [],
  };

  // Notify processors of span start
  for (const processor of spanProcessors) {
    try {
      processor.onStart(span);
    } catch (error) {
      logger.debug("[Tracing] Span processor onStart error", { error: String(error) });
    }
  }

  const activeSpan: ActiveSpan = {
    ...span,

    setAttribute(key: string, value: string | number | boolean): void {
      this.attributes[key] = value;
    },

    setAttributes(attributes: SpanAttributes): void {
      Object.assign(this.attributes, attributes);
    },

    addEvent(eventName: string, attributes?: SpanAttributes): void {
      this.events.push({
        name: eventName,
        timestamp: Date.now(),
        attributes,
      });
    },

    setStatus(status: SpanStatus, message?: string): void {
      this.status = status;
      this.statusMessage = message;
    },

    recordError(error: Error | unknown): void {
      this.status = SpanStatus.ERROR;
      
      if (error instanceof Error) {
        this.statusMessage = error.message;
        this.setAttribute("error.type", error.name);
        this.setAttribute("error.message", error.message);
        if (error.stack) {
          this.setAttribute("error.stack", error.stack.substring(0, 500));
        }
      } else {
        this.statusMessage = String(error);
        this.setAttribute("error.message", String(error));
      }

      this.addEvent("exception", {
        "exception.type": error instanceof Error ? error.name : "Error",
        "exception.message": error instanceof Error ? error.message : String(error),
      });
    },

    end(): void {
      this.endTime = Date.now();
      this.duration = this.endTime - this.startTime;

      // Set status to OK if not already set
      if (this.status === SpanStatus.UNSET) {
        this.status = SpanStatus.OK;
      }

      // Notify processors of span end
      for (const processor of spanProcessors) {
        try {
          processor.onEnd(this);
        } catch (error) {
          logger.debug("[Tracing] Span processor onEnd error", { error: String(error) });
        }
      }
    },

    getContext(): SpanContext {
      return {
        traceId: this.traceId,
        spanId: this.spanId,
        traceFlags: this.status === SpanStatus.ERROR ? 1 : 0,
      };
    },
  };

  return activeSpan;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start a new span
 */
export function startSpan(
  name: string,
  kind: SpanKind = SpanKind.INTERNAL,
  attributes?: SpanAttributes
): ActiveSpan {
  const parentContext = tracingStorage.getStore();
  const span = createActiveSpan(name, kind, parentContext);

  if (attributes) {
    span.setAttributes(attributes);
  }

  return span;
}

/**
 * Execute a function within a span context
 */
export function withSpan<T>(
  name: string,
  fn: (span: ActiveSpan) => T,
  options?: {
    kind?: SpanKind;
    attributes?: SpanAttributes;
  }
): T {
  const span = startSpan(name, options?.kind, options?.attributes);
  const context: TracingContext = {
    currentSpan: span,
    traceId: span.traceId,
  };

  try {
    const result = tracingStorage.run(context, () => fn(span));
    
    // Handle promises
    if (result instanceof Promise) {
      return result
        .then((value) => {
          span.setStatus(SpanStatus.OK);
          span.end();
          return value;
        })
        .catch((error) => {
          span.recordError(error);
          span.end();
          throw error;
        }) as T;
    }

    span.setStatus(SpanStatus.OK);
    span.end();
    return result;
  } catch (error) {
    span.recordError(error);
    span.end();
    throw error;
  }
}

/**
 * Execute an async function within a span context
 */
export async function withSpanAsync<T>(
  name: string,
  fn: (span: ActiveSpan) => Promise<T>,
  options?: {
    kind?: SpanKind;
    attributes?: SpanAttributes;
  }
): Promise<T> {
  const span = startSpan(name, options?.kind, options?.attributes);
  const context: TracingContext = {
    currentSpan: span,
    traceId: span.traceId,
  };

  try {
    const result = await tracingStorage.run(context, () => fn(span));
    span.setStatus(SpanStatus.OK);
    span.end();
    return result;
  } catch (error) {
    span.recordError(error);
    span.end();
    throw error;
  }
}

/**
 * Get the current span (if any)
 */
export function getCurrentSpan(): ActiveSpan | undefined {
  return tracingStorage.getStore()?.currentSpan;
}

/**
 * Get the current trace ID (if any)
 */
export function getCurrentTraceId(): string | undefined {
  return tracingStorage.getStore()?.traceId;
}

/**
 * Add an event to the current span
 */
export function addSpanEvent(name: string, attributes?: SpanAttributes): void {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set attributes on the current span
 */
export function setSpanAttributes(attributes: SpanAttributes): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

// =============================================================================
// HTTP Tracing Helpers
// =============================================================================

/**
 * Extract trace context from HTTP headers (W3C Trace Context format)
 */
export function extractTraceContext(headers: Headers): SpanContext | null {
  const traceparent = headers.get("traceparent");
  
  if (!traceparent) {
    return null;
  }

  // W3C Trace Context format: version-traceId-spanId-traceFlags
  const parts = traceparent.split("-");
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, traceFlags] = parts;

  // Only support version 00
  if (version !== "00") {
    return null;
  }

  // Validate trace ID and span ID lengths
  if (traceId.length !== 32 || spanId.length !== 16) {
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags: parseInt(traceFlags, 16) || 0,
  };
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(headers: Headers, context: SpanContext): void {
  const traceparent = `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, "0")}`;
  headers.set("traceparent", traceparent);
}

/**
 * Create a server span from an HTTP request
 */
export function startServerSpan(request: Request): ActiveSpan {
  const url = new URL(request.url);
  const parentContext = extractTraceContext(request.headers);

  const span = startSpan(
    `HTTP ${request.method} ${url.pathname}`,
    SpanKind.SERVER,
    {
      "http.method": request.method,
      "http.url": request.url,
      "http.target": url.pathname + url.search,
      "http.host": url.host,
      "http.scheme": url.protocol.replace(":", ""),
    }
  );

  // Link to parent trace if available
  if (parentContext) {
    span.links.push({
      traceId: parentContext.traceId,
      spanId: parentContext.spanId,
    });
  }

  return span;
}

/**
 * End a server span with HTTP response details
 */
export function endServerSpan(
  span: ActiveSpan,
  response: Response | { status: number }
): void {
  span.setAttribute("http.status_code", response.status);

  if (response.status >= 400) {
    span.setStatus(SpanStatus.ERROR, `HTTP ${response.status}`);
  } else {
    span.setStatus(SpanStatus.OK);
  }

  span.end();
}

// =============================================================================
// Database Tracing Helpers
// =============================================================================

/**
 * Create a database span
 */
export function startDbSpan(
  operation: string,
  table?: string
): ActiveSpan {
  const name = table ? `DB ${operation} ${table}` : `DB ${operation}`;
  
  return startSpan(name, SpanKind.CLIENT, {
    "db.system": "postgresql",
    "db.operation": operation,
    ...(table && { "db.sql.table": table }),
  });
}

/**
 * Wrap a database operation with tracing
 */
export async function traceDbOperation<T>(
  operation: string,
  table: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const span = startDbSpan(operation, table);

  try {
    const result = await fn();
    span.setStatus(SpanStatus.OK);
    span.end();
    return result;
  } catch (error) {
    span.recordError(error);
    span.end();
    throw error;
  }
}

// =============================================================================
// External Service Tracing Helpers
// =============================================================================

/**
 * Create a span for external HTTP calls
 */
export function startExternalHttpSpan(
  method: string,
  url: string,
  serviceName: string
): ActiveSpan {
  const parsedUrl = new URL(url);
  
  return startSpan(
    `HTTP ${method} ${serviceName}`,
    SpanKind.CLIENT,
    {
      "http.method": method,
      "http.url": url,
      "http.host": parsedUrl.host,
      "peer.service": serviceName,
    }
  );
}

/**
 * Wrap an external HTTP call with tracing
 */
export async function traceExternalHttp<T>(
  method: string,
  url: string,
  serviceName: string,
  fn: () => Promise<T>
): Promise<T> {
  const span = startExternalHttpSpan(method, url, serviceName);

  try {
    const result = await fn();
    span.setStatus(SpanStatus.OK);
    span.end();
    return result;
  } catch (error) {
    span.recordError(error);
    span.end();
    throw error;
  }
}

// =============================================================================
// Exports
// =============================================================================

export const tracing = {
  startSpan,
  withSpan,
  withSpanAsync,
  getCurrentSpan,
  getCurrentTraceId,
  addSpanEvent,
  setSpanAttributes,
  startServerSpan,
  endServerSpan,
  startDbSpan,
  traceDbOperation,
  startExternalHttpSpan,
  traceExternalHttp,
  extractTraceContext,
  injectTraceContext,
  registerSpanProcessor,
  removeSpanProcessor,
};

