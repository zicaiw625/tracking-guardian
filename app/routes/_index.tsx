import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { login } from "../shopify.server";

// Root route - redirects to app or login
// Note: Using json() for all responses to comply with Remix Single Fetch requirements
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  
  // Handle health check requests (HEAD or GET from Render health checks)
  // Render performs health checks every 5 seconds
  if (request.method === "HEAD") {
    return json({ status: "ok" });
  }
  
  // Quick health check endpoint for monitoring
  // This handles the repeated GET / requests from Render
  const userAgent = request.headers.get("user-agent") || "";
  if (userAgent.includes("Render") || userAgent.includes("kube-probe")) {
    return json({ status: "ok" });
  }
  
  // If accessing with shop parameter, try to authenticate
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  
  // Otherwise show login page
  // Wrap in try-catch to ensure we always return a proper Response
  try {
    const loginResponse = await login(request);
    // If login returns a Response, return it directly
    if (loginResponse instanceof Response) {
      return loginResponse;
    }
    // Otherwise wrap in json() for Single Fetch compatibility
    return json(loginResponse);
  } catch (error) {
    // If login throws a redirect, let it propagate
    throw error;
  }
};

