import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { jsonWithCors } from "~/lib/pixel-events/cors";
import { buildInitialContext } from "~/lib/pixel-events/build-initial-context";
import { composeIngestMiddleware } from "~/lib/pixel-events/middleware/compose";
import { corsMiddleware } from "~/lib/pixel-events/middleware/cors.middleware";
import { rateLimitPreBodyMiddleware } from "~/lib/pixel-events/middleware/rate-limit.middleware";
import { bodyReaderMiddleware } from "~/lib/pixel-events/middleware/body-reader.middleware";
import { originValidationPreBodyMiddleware } from "~/lib/pixel-events/middleware/origin-validation.middleware";
import { timestampValidationMiddleware } from "~/lib/pixel-events/middleware/timestamp-validation.middleware";
import { eventValidationMiddleware } from "~/lib/pixel-events/middleware/event-validation.middleware";
import { shopLoadingMiddleware } from "~/lib/pixel-events/middleware/shop-loading.middleware";
import { originValidationPostShopMiddleware } from "~/lib/pixel-events/middleware/origin-validation.middleware";
import { hmacValidationMiddleware } from "~/lib/pixel-events/middleware/hmac-validation.middleware";
import { rateLimitPostShopMiddleware } from "~/lib/pixel-events/middleware/rate-limit-post-shop.middleware";
import { enqueueMiddleware } from "~/lib/pixel-events/middleware/enqueue.middleware";

export const action = async ({ request }: ActionFunctionArgs) => {
  const initialContext = buildInitialContext(request);
  const middlewares = [
    corsMiddleware,
    rateLimitPreBodyMiddleware,
    bodyReaderMiddleware,
    originValidationPreBodyMiddleware,
    timestampValidationMiddleware,
    eventValidationMiddleware,
    shopLoadingMiddleware,
    originValidationPostShopMiddleware,
    hmacValidationMiddleware,
    rateLimitPostShopMiddleware,
    enqueueMiddleware,
  ];
  return composeIngestMiddleware(middlewares, initialContext);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return jsonWithCors(
    {
      status: "ok",
      endpoint: "ingest",
      message: "This is the only pixel event ingestion endpoint. Use POST /ingest to send pixel events.",
    },
    { request }
  );
};
