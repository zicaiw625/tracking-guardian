#!/usr/bin/env node
const userAgent = process.env.npm_config_user_agent || "";

const isPnpm = userAgent.includes("pnpm/");
const isYarnPnp = Boolean(process.versions?.pnp) || userAgent.includes("yarn/");

if (!isPnpm || isYarnPnp) {
  console.error(
    "This project now uses pnpm workspaces exclusively. Yarn (including Yarn PnP) and npm installs are not supported."
  );
  console.error(`Current user agent: ${userAgent}`);
  console.error("Please reinstall dependencies with pnpm.");
  process.exit(1);
}
