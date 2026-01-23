export async function readTextWithLimit(
  request: Request,
  maxSize: number
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  const parts: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxSize) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
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
      parts.push(decoder.decode(value, { stream: true }));
    }
  }
  parts.push(decoder.decode());
  return parts.join("");
}

export async function readJsonWithLimit<T = unknown>(
  request: Request,
  maxSize: number
): Promise<T> {
  const text = await readTextWithLimit(request, maxSize);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw error;
  }
}
