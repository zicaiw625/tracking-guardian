import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("../lib/api-routes/api.analytics-track");
  return A(args);
};
