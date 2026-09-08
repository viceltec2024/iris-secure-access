import { DEV_IDENTITY_COOKIE, devAuthEnabled, safeDevReturnPath } from "../../dev-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!devAuthEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const returnTo = safeDevReturnPath(url.searchParams.get("return_to") || "/");
  const cookie = [
    `${DEV_IDENTITY_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo === "/dashboard" ? "/" : returnTo, "Set-Cookie": cookie },
  });
}
