import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { i18nCookie } from "../i18n.server";

const supportedLocales = new Set(["en", "zh"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const locale = String(formData.get("locale") || formData.get("lng") || "");

  if (!supportedLocales.has(locale)) {
    return json({ error: "Unsupported locale" }, { status: 400 });
  }

  return json(
    { ok: true, locale },
    {
      headers: {
        "Set-Cookie": await i18nCookie.serialize(locale),
      },
    }
  );
};

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  return json({ error: "Method not allowed" }, { status: 405 });
};
