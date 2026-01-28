import type { IngestContext, IngestMiddleware } from "./types";

export async function composeIngestMiddleware(
  middlewares: IngestMiddleware[],
  initialContext: IngestContext
): Promise<Response> {
  let context = initialContext;

  for (const middleware of middlewares) {
    const result = await middleware(context);
    if (!result.continue) {
      return result.response;
    }
    context = result.context;
  }

  throw new Error("Middleware pipeline completed without returning a response");
}
