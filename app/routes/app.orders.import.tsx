import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, Page, Text } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { importOrderSummariesFromCsv } from "~/services/orders/manual-import.server";
import { getOrderDataAvailability } from "~/services/orders/order-data-mode.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true, shopDomain: true },
  });
  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }
  const availability = await getOrderDataAvailability(shop.id, 7);
  return json({ shop, availability });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 404 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return json({ ok: false, error: "CSV file is required" }, { status: 400 });
  }

  const text = await file.text();
  try {
    const result = await importOrderSummariesFromCsv(shop.id, text);
    return json({ ok: true, result });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Import failed" },
      { status: 400 }
    );
  }
};

export default function OrdersImportPage() {
  const { availability } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <Page
      title="导入订单摘要"
      subtitle="上传 CSV（orderId,total,currency,createdAt）启用订单对账"
      backAction={{ content: "返回验收", url: "/app/verification" }}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              当前模式：{availability.mode}
            </Text>
            <Text as="p" variant="bodyMd">
              近 7 天摘要条数：{availability.summaryCountLastNDays}
            </Text>
          </BlockStack>
        </Card>
        {actionData && "error" in actionData && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData && "result" in actionData && (
          <Banner tone="success">
            <p>
              导入完成：共 {actionData.result.total} 行，成功 {actionData.result.imported} 行，跳过{" "}
              {actionData.result.skipped} 行。
            </p>
          </Banner>
        )}
        <Card>
          <form method="post" encType="multipart/form-data">
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" tone="subdued">
                CSV 首行需包含：orderId,total,currency,createdAt
              </Text>
              <input type="file" name="file" accept=".csv,text/csv" required />
              <Button submit variant="primary">
                开始导入
              </Button>
            </BlockStack>
          </form>
        </Card>
      </BlockStack>
    </Page>
  );
}
