import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async (args: LoaderFunctionArgs) => {
  const { loader: L } = await import("../lib/api-routes/api.checklist-pdf");
  return L(args);
};
