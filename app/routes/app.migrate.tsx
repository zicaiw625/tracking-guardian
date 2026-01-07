import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const search = url.searchParams.toString();
  const target = search ? `/app/pixels?${search}` : "/app/pixels";
  return redirect(target, { status: 302 });
};

export const action = async () => {
  return redirect("/app/pixels", { status: 302 });
};

export default function MigrateRedirect() {
  return null;
}
