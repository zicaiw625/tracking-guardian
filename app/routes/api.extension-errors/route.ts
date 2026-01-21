import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("../../lib/api-routes/extension-errors");
  return A(args);
};
