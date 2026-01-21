import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("../../lib/api-routes/tracking");
  return A(args);
};

export const loader = async (args: LoaderFunctionArgs) => {
  const { loader: L } = await import("../../lib/api-routes/tracking");
  return L(args);
};
