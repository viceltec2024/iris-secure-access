import vinext from "vinext";
import { defineConfig, loadEnv, type Plugin } from "vite";
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

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSandbox = Boolean(process.env.CODEX_SANDBOX);
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

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
      // Worker name, D1, and compatibility flags come from root wrangler.jsonc.
      // Do not also pass an inline `config` object here — that duplicates D1 bindings.
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
