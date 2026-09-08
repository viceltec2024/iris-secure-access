import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSandbox = Boolean(process.env.CODEX_SANDBOX);
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const localEnv = loadEnv(mode, process.cwd(), "");
  const allowLocalAuth = command === "serve" && (localEnv.IRIS_DEV_SKIP_STEPUP === "1" || isCodexSandbox);
  const publicOrigin = localEnv.IRIS_PUBLIC_ORIGIN || process.env.IRIS_PUBLIC_ORIGIN || "";
  if (publicOrigin) process.env.IRIS_PUBLIC_ORIGIN = publicOrigin;
  const define: Record<string, string> = {};
  if (publicOrigin) define["process.env.IRIS_PUBLIC_ORIGIN"] = JSON.stringify(publicOrigin);
  if (allowLocalAuth) {
    define["process.env.IRIS_DEV_SKIP_STEPUP"] = JSON.stringify("1");
    define["process.env.IRIS_DEV_EMAIL"] = JSON.stringify(localEnv.IRIS_DEV_EMAIL || "owner@iris.local");
    define["process.env.IRIS_OWNER_EMAIL"] = JSON.stringify(localEnv.IRIS_OWNER_EMAIL || "owner@iris.local");
    define["process.env.IRIS_DEV_WALLET"] = JSON.stringify(localEnv.IRIS_DEV_WALLET || "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1");
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: true,
      allowedHosts: true,
      ...(isCodexSandbox || isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    define,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
