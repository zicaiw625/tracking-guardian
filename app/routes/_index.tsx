import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { login } from "../shopify.server";

// Root route - redirects to app or login
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  
  // Handle health check requests (HEAD method from Render)
  if (request.method === "HEAD") {
    return json({ status: "ok" });
  }
  
  // If accessing with shop parameter, try to authenticate
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  
  // Otherwise show login page
  return login(request);
};

