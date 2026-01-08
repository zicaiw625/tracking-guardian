import { randomBytes } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "./logger.server";

export enum SpanStatus {
  UNSET = "unset",
  OK = "ok",
  ERROR = "error",
}

export enum SpanKind {
  INTERNAL = "internal",
  SERVER = "server",
  CLIENT = "client",
  PRODUCER = "producer",
  CONSUMER = "consumer",
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: SpanAttributes;
}

export interface SpanLink {
  traceId: string;
  spanId: string;
  attributes?: SpanAttributes;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface Span {

  name: string;

  traceId: string;

  spanId: string;

  parentSpanId?: string;

  kind: SpanKind;

  startTime: number;

  endTime?: number;

  duration?: number;

  status: SpanStatus;

  statusMessage?: string;

  attributes: SpanAttributes;

  events: SpanEvent[];

  links: SpanLink[];
}

export interface ActiveSpan extends Span {

  setAttribute(key: string, value: string | number | boolean): void;

  setAttributes(attributes: SpanAttributes): void;

  addEvent(name: string, attributes?: SpanAttributes): void;

  setStatus(status: SpanStatus, message?: string): void;

  recordError(error: Error | unknown): void;

  end(): void;

  getContext(): SpanContext;
}

export interface SpanProcessor {
  onStart(span: Span): void;
  onEnd(span: Span): void;
}

function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

interface TracingContext {
  currentSpan?: ActiveSpan;
  traceId: string;
}

const tracingStorage = new AsyncLocalStorage<TracingContext>();

const spanProcessors: SpanProcessor[] = [];

export function registerSpanProcessor(processor: SpanProcessor): void {
  spanProcessors.push(processor);
}

export function removeSpanProcessor(processor: SpanProcessor): void {
  const index = spanProcessors.indexOf(processor);
  if (index !== -1) {
    spanProcessors.splice(index, 1);
  }
}

const loggingProcessor: SpanProcessor = {
  onStart: () => {

  },
  onEnd: (span) => {

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

spanProcessors.push(loggingProcessor);

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

      if (this.status === SpanStatus.UNSET) {
        this.status = SpanStatus.OK;
      }

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

export function getCurrentSpan(): ActiveSpan | undefined {
  return tracingStorage.getStore()?.currentSpan;
}

export function getCurrentTraceId(): string | undefined {
  return tracingStorage.getStore()?.traceId;
}

export function addSpanEvent(name: string, attributes?: SpanAttributes): void {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

export function setSpanAttributes(attributes: SpanAttributes): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

export function extractTraceContext(headers: Headers): SpanContext | null {
  const traceparent = headers.get("traceparent");

  if (!traceparent) {
    return null;
  }

  const parts = traceparent.split("-");
  if (parts.length !== 4) {
    return null;
  }

  const [version, traceId, spanId, traceFlags] = parts;

  if (version !== "00") {
    return null;
  }

  if (traceId.length !== 32 || spanId.length !== 16) {
    return null;
  }

  return {
    traceId,
    spanId,
    traceFlags: parseInt(traceFlags, 16) || 0,
  };
}

export function injectTraceContext(headers: Headers, context: SpanContext): void {
  const traceparent = `00-${context.traceId}-${context.spanId}-${context.traceFlags.toString(16).padStart(2, "0")}`;
  headers.set("traceparent", traceparent);
}

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

  if (parentContext) {
    span.links.push({
      traceId: parentContext.traceId,
      spanId: parentContext.spanId,
    });
  }

  return span;
}

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
