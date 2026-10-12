import vinext from "vinext";
import { defineConfig, loadEnv, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import d1Config from "./config/d1.json";
import { sites } from "./build/sites-vite-plugin";

function irisHmrBehindProxy(): Plugin {
  return {
    name: "iris-hmr-behind-proxy",
    apply: "serve",
    transform(code, id) {
      if (!id.includes("vite/dist/client/client")) return;
      let next = code.replace(
        "const hmrPort = __HMR_PORT__;",
        `const pageUrl = new URL(import.meta.url);\nconst hmrPort = pageUrl.port || (pageUrl.protocol === "https:" ? "443" : "80");`,
      );
      next = next.replace(
        "else throw new Error(\"send was called before connect\");",
        "else return;",
      );
      next = next.replace(
        "else throw new Error(\"invoke was called before connect\");",
        "else return undefined;",
      );
      return next === code ? undefined : next;
    },
  };
}

const { d1, r2 } = hostingConfig;

// Prefer an explicit override, then the committed Cloudflare D1 id. Local
// Miniflare only needs a stable UUID; production deploy rejects the old Sites
// placeholder (00000000-0000-4000-8000-000000000000).
const databaseId =
  process.env.CLOUDFLARE_D1_DATABASE_ID?.trim() || d1Config.database_id;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSandbox = Boolean(process.env.CODEX_SANDBOX);
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  name: "iris-secure-access",
  main: "./worker/index.ts",
  compatibility_date: "2026-04-01",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: d1Config.database_name,
          database_id: databaseId,
          migrations_dir: d1Config.migrations_dir,
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
      hmr: {
        overlay: false,
      },
      ...(isCodexSandbox || isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    define,
    plugins: [
      irisHmrBehindProxy(),
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
