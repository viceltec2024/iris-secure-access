import "server-only";

export const DEV_IDENTITY_COOKIE = "iris_dev_identity";
export const DEV_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const RESERVED_AUTH_PATHS = new Set([
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
  "/dev/sign-in",
  "/dev/sign-out",
]);

export function devAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.IRIS_DEV_SKIP_STEPUP === "1";
}

export function devDefaultEmail(): string {
  return (process.env.IRIS_DEV_EMAIL || "owner@iris.local").trim().toLowerCase();
}

export function safeDevReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/dashboard";
  }

  if (url.origin !== "https://app.local") return "/dashboard";
  if (RESERVED_AUTH_PATHS.has(url.pathname)) return "/dashboard";
  return `${url.pathname}${url.search}${url.hash}`;
}
