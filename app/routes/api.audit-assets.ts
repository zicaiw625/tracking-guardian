import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (args: LoaderFunctionArgs) => {
  const { loader: L } = await import("./api.audit-assets.server");
  return L(args);
};

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("./api.audit-assets.server");
  return A(args);
};
