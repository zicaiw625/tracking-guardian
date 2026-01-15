import { API_CONFIG } from "./config";
import { logger } from "./logger.server";

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
  const bodyText = await request.text();
  if (bodyText.length > maxSize) {
    logger.warn(`Request body too large: ${bodyText.length} bytes (max ${maxSize})`);
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
