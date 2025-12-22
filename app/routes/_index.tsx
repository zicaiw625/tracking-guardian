import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { login } from "../shopify.server";
export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    if (request.method === "HEAD") {
        return json({ status: "ok" });
    }
    const userAgent = request.headers.get("user-agent") || "";
    if (userAgent.includes("Render") || userAgent.includes("kube-probe")) {
        return json({ status: "ok" });
    }
    if (url.searchParams.get("shop")) {
        throw redirect(`/app?${url.searchParams.toString()}`);
    }
    try {
        const loginResponse = await login(request);
        if (loginResponse instanceof Response) {
            return loginResponse;
        }
        return json(loginResponse);
    }
    catch (error) {
        throw error;
    }
};
