import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig, type UserConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

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

function suppressUndiciWarnings(): Plugin {
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  const suppressPatterns = [
    "has been externalized for browser compatibility",
    "undici",
    "node:assert",
    "node:buffer",
    "node:crypto",
    "node:zlib",
    "dynamic import will not move module into another chunk",
  ];
  const shouldSuppress = (message: unknown): boolean => {
    if (typeof message !== "string") return false;
    return suppressPatterns.some(pattern => message.includes(pattern));
  };
  return {
    name: "suppress-undici-warnings",
    enforce: "pre",
    configResolved() {
      originalWarn = console.warn;
      originalError = console.error;
      console.warn = (...args: unknown[]) => {
        if (shouldSuppress(args[0])) return;
        originalWarn.apply(console, args);
      };
      console.error = (...args: unknown[]) => {
        if (shouldSuppress(args[0])) return;
        originalError.apply(console, args);
      };
    },
    buildEnd() {
      if (originalWarn) console.warn = originalWarn;
      if (originalError) console.error = originalError;
    },
  };
}

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
    suppressUndiciWarnings(),
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
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
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          (warning.message && warning.message.includes("has been externalized for browser compatibility"))
        ) {
          return;
        }
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          (warning.message && warning.message.includes("dynamic import will not move module into another chunk"))
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
    external: ["html-pdf-node", "undici"],
  },
  optimizeDeps: {
    exclude: ["undici"],
  },
}) satisfies UserConfig;
