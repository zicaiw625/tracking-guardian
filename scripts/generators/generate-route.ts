#!/usr/bin/env node --experimental-strip-types
/**
 * Route Generator Script
 *
 * Generates boilerplate for new Remix routes with consistent patterns.
 *
 * Usage:
 *   node --experimental-strip-types scripts/generators/generate-route.ts app.my-route
 *   node --experimental-strip-types scripts/generators/generate-route.ts api.my-endpoint --type api
 *   node --experimental-strip-types scripts/generators/generate-route.ts settings.platform --type settings
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Types
// =============================================================================

type RouteType = "page" | "api" | "settings";

interface RouteConfig {
  name: string;
  type: RouteType;
  hasLoader: boolean;
  hasAction: boolean;
}

// =============================================================================
// Templates
// =============================================================================

const PAGE_TEMPLATE = `import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

// =============================================================================
// Types
// =============================================================================

interface LoaderData {
  // Define your loader data type here
}

interface ActionData {
  success: boolean;
  error?: string;
}

// =============================================================================
// Loader
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  logger.debug("[{{NAME}}] Loading data", { shopDomain });

  // TODO: Implement loader logic
  const data: LoaderData = {};

  return json(data);
};

// =============================================================================
// Action
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  logger.debug("[{{NAME}}] Processing action", { shopDomain });

  try {
    const formData = await request.formData();
    // TODO: Implement action logic

    return json<ActionData>({ success: true });
  } catch (error) {
    logger.error("[{{NAME}}] Action failed", error, { shopDomain });
    return json<ActionData>({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// =============================================================================
// Component
// =============================================================================

export default function {{COMPONENT_NAME}}() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();

  return (
    <Page title="{{TITLE}}">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {{TITLE}}
              </Text>
              {actionData?.error && (
                <Text as="p" tone="critical">
                  {actionData.error}
                </Text>
              )}
              {/* TODO: Implement UI */}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
`;

const API_TEMPLATE = `import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";
import { API_SECURITY_HEADERS } from "../utils/security";

// =============================================================================
// Types
// =============================================================================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// =============================================================================
// Loader (GET)
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;

    logger.debug("[{{NAME}}] GET request", { shopDomain });

    // TODO: Implement GET logic
    const data = {};

    return json<ApiResponse<typeof data>>(
      { success: true, data },
      { headers: API_SECURITY_HEADERS }
    );
  } catch (error) {
    logger.error("[{{NAME}}] GET failed", error);
    return json<ApiResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: API_SECURITY_HEADERS }
    );
  }
};

// =============================================================================
// Action (POST/PUT/DELETE)
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop;
    const method = request.method;

    logger.debug("[{{NAME}}] \${method} request", { shopDomain });

    const body = await request.json();
    // TODO: Validate body with Zod schema

    switch (method) {
      case "POST":
        // TODO: Implement POST logic
        return json<ApiResponse<unknown>>(
          { success: true, data: {} },
          { status: 201, headers: API_SECURITY_HEADERS }
        );

      case "PUT":
      case "PATCH":
        // TODO: Implement PUT/PATCH logic
        return json<ApiResponse<unknown>>(
          { success: true, data: {} },
          { headers: API_SECURITY_HEADERS }
        );

      case "DELETE":
        // TODO: Implement DELETE logic
        return json<ApiResponse<unknown>>(
          { success: true },
          { headers: API_SECURITY_HEADERS }
        );

      default:
        return json<ApiResponse<never>>(
          { success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" },
          { status: 405, headers: API_SECURITY_HEADERS }
        );
    }
  } catch (error) {
    logger.error("[{{NAME}}] Action failed", error);
    return json<ApiResponse<never>>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: API_SECURITY_HEADERS }
    );
  }
};
`;

const SETTINGS_TEMPLATE = `import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  TextField,
  Button,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { logger } from "../../utils/logger.server";
import { useFormDirty } from "../../hooks";

// =============================================================================
// Types
// =============================================================================

interface LoaderData {
  // Define settings data type
  settings: {
    // fields
  };
}

interface ActionData {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

// =============================================================================
// Loader
// =============================================================================

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  logger.debug("[{{NAME}}] Loading settings", { shopDomain });

  // TODO: Load settings from database
  const settings = {};

  return json<LoaderData>({ settings });
};

// =============================================================================
// Action
// =============================================================================

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  logger.debug("[{{NAME}}] Saving settings", { shopDomain });

  try {
    const formData = await request.formData();
    
    // TODO: Validate and save settings
    // const schema = z.object({ ... });
    // const result = schema.safeParse(Object.fromEntries(formData));

    return json<ActionData>({ success: true });
  } catch (error) {
    logger.error("[{{NAME}}] Save failed", error, { shopDomain });
    return json<ActionData>({
      success: false,
      error: error instanceof Error ? error.message : "保存失败",
    });
  }
};

// =============================================================================
// Component
// =============================================================================

export default function {{COMPONENT_NAME}}Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Track form dirty state
  const { isDirty, setInitialValues, handleChange } = useFormDirty();

  return (
    <Page
      title="{{TITLE}} 设置"
      backAction={{ url: "/app/settings" }}
    >
      <Layout>
        {actionData?.success && (
          <Layout.Section>
            <Banner tone="success">设置已保存</Banner>
          </Layout.Section>
        )}

        {actionData?.error && (
          <Layout.Section>
            <Banner tone="critical">{actionData.error}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Form method="post">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {{TITLE}} 配置
                </Text>

                <FormLayout>
                  {/* TODO: Add form fields */}
                </FormLayout>

                <Button
                  variant="primary"
                  submit
                  loading={isSubmitting}
                  disabled={!isDirty}
                >
                  保存设置
                </Button>
              </BlockStack>
            </Card>
          </Form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
`;

// =============================================================================
// Generator Logic
// =============================================================================

function parseArgs(): RouteConfig {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: generate-route <route-name> [--type page|api|settings]");
    process.exit(1);
  }

  const name = args[0];
  let type: RouteType = "page";

  const typeIndex = args.indexOf("--type");
  if (typeIndex !== -1 && args[typeIndex + 1]) {
    type = args[typeIndex + 1] as RouteType;
  }

  // Auto-detect type from name
  if (name.startsWith("api.")) {
    type = "api";
  } else if (name.startsWith("settings.") || name.includes("/settings/")) {
    type = "settings";
  }

  return {
    name,
    type,
    hasLoader: true,
    hasAction: true,
  };
}

function toComponentName(routeName: string): string {
  return routeName
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toTitle(routeName: string): string {
  const baseName = routeName.replace(/^(app\.|api\.|settings\.)/, "");
  return baseName
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getTemplate(type: RouteType): string {
  switch (type) {
    case "api":
      return API_TEMPLATE;
    case "settings":
      return SETTINGS_TEMPLATE;
    default:
      return PAGE_TEMPLATE;
  }
}

function generateRoute(config: RouteConfig): void {
  const template = getTemplate(config.type);
  const componentName = toComponentName(config.name);
  const title = toTitle(config.name);

  let content = template
    .replace(/\{\{NAME\}\}/g, config.name)
    .replace(/\{\{COMPONENT_NAME\}\}/g, componentName)
    .replace(/\{\{TITLE\}\}/g, title);

  // Determine output path
  let outputPath: string;
  if (config.type === "settings") {
    const settingsName = config.name.replace(/^settings\./, "");
    outputPath = path.join(
      process.cwd(),
      "app/routes/settings",
      `${settingsName}.tsx`
    );
  } else {
    outputPath = path.join(
      process.cwd(),
      "app/routes",
      `${config.name}.tsx`
    );
  }

  // Create directory if needed
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Check if file exists
  if (fs.existsSync(outputPath)) {
    console.error(`File already exists: ${outputPath}`);
    process.exit(1);
  }

  // Write file
  fs.writeFileSync(outputPath, content);
  console.log(`✓ Created ${outputPath}`);

  // Generate test file
  const testPath = outputPath.replace("/app/routes/", "/tests/routes/").replace(".tsx", ".test.ts");
  const testDir = path.dirname(testPath);
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testContent = generateTestFile(config);
  fs.writeFileSync(testPath, testContent);
  console.log(`✓ Created ${testPath}`);
}

function generateTestFile(config: RouteConfig): string {
  return `import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockAdminContext, createMockPrismaClient } from "../mocks";

describe("${config.name}", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("loader", () => {
    it("should return data for authenticated users", async () => {
      // TODO: Implement test
      expect(true).toBe(true);
    });
  });

  describe("action", () => {
    it("should handle POST requests", async () => {
      // TODO: Implement test
      expect(true).toBe(true);
    });
  });
});
`;
}

// =============================================================================
// Main
// =============================================================================

const config = parseArgs();
generateRoute(config);

