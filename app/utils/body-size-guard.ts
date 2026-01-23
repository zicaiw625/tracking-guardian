import { API_CONFIG } from "./config.server";
import { logger } from "./logger.server";
import { readTextWithLimit } from "./body-reader";

export async function readJsonWithSizeLimit<T = unknown>(
  request: Request,
  maxSize: number = API_CONFIG.MAX_BODY_SIZE
): Promise<T> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > maxSize) {
      logger.warn(`Request body too large: ${size} bytes (max ${maxSize})`);
      throw new Response(
        JSON.stringify({
          error: "Payload too large",
          maxSize,
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  }
  const bodyText = await readTextWithLimit(request, maxSize);
  try {
    return JSON.parse(bodyText) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    throw error;
  }
}
