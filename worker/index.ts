/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isPublicAgentPath, trustedIdentityHosts, withoutUntrustedIdentity } from "../lib/iris-origin";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IRIS_TRUSTED_HOSTS?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  /**
   * Optional cron hook. Durable agent ticks are primarily drained request-scoped
   * via Creator GET / process_ticks. A Sites cron can call that path later without
   * auto-applying repo changes.
   */
  async scheduled(event: { cron?: string; scheduledTime?: number }, env: Env, ctx: ExecutionContext) {
    // Intentionally no self-modify / no repo apply. Request-scoped drains remain the source of truth.
    void event;
    void env;
    void ctx;
    return;
  },

  async fetch(incoming: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Las cabeceras de identidad de Sites solo cuentan si la petición llega
    // por un host de confianza (ver withoutUntrustedIdentity).
    const request = withoutUntrustedIdentity(
      incoming,
      trustedIdentityHosts(String(env.IRIS_TRUSTED_HOSTS || process.env.IRIS_TRUSTED_HOSTS || "")),
      process.env.NODE_ENV !== "production",
    );
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (request.method === "OPTIONS" && isPublicAgentPath(url.pathname)) {
      return new Response(null, { status: 204, headers: agentCorsHeaders() });
    }

    const response = await handler.fetch(request, env, ctx);
    if (!isPublicAgentPath(url.pathname)) return response;
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(agentCorsHeaders())) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

function agentCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Iris-Timestamp, X-Iris-Nonce, X-Iris-Signature",
    "Cache-Control": "no-store",
  };
}

export default worker;
