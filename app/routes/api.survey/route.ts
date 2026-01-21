import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

export const action = async (args: ActionFunctionArgs) => {
  const { action: A } = await import("./route.server");
  return A(args);
};

export const loader = async (args: LoaderFunctionArgs) => {
  const { loader: L } = await import("./route.server");
  return L(args);
};
