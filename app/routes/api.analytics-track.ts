import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("./api.analytics-track.server");
  return A(args);
};
