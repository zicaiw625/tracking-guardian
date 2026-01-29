import { optionsResponse, jsonWithCors } from "../cors";
import type { IngestContext, IngestMiddleware, MiddlewareResult } from "./types";

export const corsMiddleware: IngestMiddleware = async (context: IngestContext): Promise<MiddlewareResult> => {
  if (context.request.method === "OPTIONS") {
    return {
      continue: false,
      response: optionsResponse(context.request),
    };
  }
  if (context.request.method !== "POST") {
    return {
      continue: false,
      response: jsonWithCors({ error: "Method not allowed" }, { status: 405, request: context.request }),
    };
  }
  return { continue: true, context };
};
