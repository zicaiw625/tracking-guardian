import { timingSafeEqual } from "crypto";

export function timingSafeEqualHex(expectedHex: string, actualHex: string): boolean {
  if (typeof expectedHex !== "string" || typeof actualHex !== "string") {
    return false;
  }
  const expectedBuffer = Buffer.from(expectedHex, "hex");
  const actualBuffer = Buffer.from(actualHex, "hex");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  try {
    return timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}
