import { logger } from "./logger.server";

export function safeFireAndForget<T>(
  promise: Promise<T>,
  errorContext?: {
    operation?: string;
    metadata?: Record<string, unknown>;
  }
): void {
  promise.catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(
      errorContext?.operation || "Fire-and-forget operation failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        ...errorContext?.metadata,
        errorMessage,
        errorStack,
      }
    );
  });
}
