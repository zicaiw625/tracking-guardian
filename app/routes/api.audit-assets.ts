import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (args: LoaderFunctionArgs) => {
  const { loader: L } = await import("../lib/api-routes/api.audit-assets");
  return L(args);
};

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("../lib/api-routes/api.audit-assets");
  return A(args);
};
