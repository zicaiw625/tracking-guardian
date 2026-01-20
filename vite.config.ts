import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

declare module "@remix-run/node" {
  interface Future {
    v3_singleFetch: true;
  }
}

if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL.match(/https?:\/\/localhost:\d+$/))
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
}

function getHostname(): string {
  const appUrl = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
  try {
    return new URL(appUrl).hostname;
  } catch {
    console.warn(`[Vite] Invalid SHOPIFY_APP_URL: ${appUrl}, using localhost`);
    return "localhost";
  }
}

const host = getHostname();

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 4096,
    sourcemap: process.env.NODE_ENV !== "production",
    rollupOptions: {
      external: ["html-pdf-node"],
      onwarn(warning, warn) {
        if (
          warning.code === "INCONSISTENT_IMPORT_ATTRIBUTES" &&
          warning.message?.includes("en.json")
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("@shopify")) {
              return "vendor-shopify";
            }
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }
            if (id.includes("chart.js") || id.includes("react-chartjs-2")) {
              return "vendor-charts";
            }
            return "vendor";
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
    minify: "esbuild",
  },
  ssr: {
    noExternal: [
      "@shopify/polaris",
      "@shopify/shopify-app-remix",
      "@shopify/app-bridge-react",
      "react-chartjs-2",
      "chart.js",
    ],
    external: ["html-pdf-node"],
  },
}) satisfies UserConfig;
