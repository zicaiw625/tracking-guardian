import type { ActionFunctionArgs } from "@remix-run/node";
import { jsonApi } from "../../utils/security-headers";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return jsonApi({ error: "Method not allowed" }, { status: 405 });
  }
  return jsonApi({ error: "公开分享功能将在后续版本中提供" }, { status: 503 });
};
