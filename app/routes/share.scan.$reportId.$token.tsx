import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Banner,
} from "@shopify/polaris";
import { PUBLIC_PAGE_HEADERS, addSecurityHeadersToHeaders } from "../utils/security-headers";

const publicJson = (data: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  addSecurityHeadersToHeaders(headers, PUBLIC_PAGE_HEADERS);
  return json(data, { ...init, headers });
};

export const loader = async ({ request: _request, params: _params }: LoaderFunctionArgs) => {
  return publicJson({
    error: null,
    report: null,
    message: "公开分享功能将在后续版本中提供",
  });
};

export default function SharedScanReport() {
  return (
    <Page title="功能即将推出">
      <Card>
        <Banner tone="info">
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              公开分享功能将在后续版本中提供
            </Text>
            <Text as="p" variant="bodySm">
              报告分享功能正在开发中，将在未来版本中推出。当前版本专注于像素事件验收和诊断。
            </Text>
          </BlockStack>
        </Banner>
      </Card>
    </Page>
  );
}
