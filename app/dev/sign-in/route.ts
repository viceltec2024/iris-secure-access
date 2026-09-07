import {
  DEV_IDENTITY_COOKIE,
  DEV_SESSION_MAX_AGE_SECONDS,
  devAuthEnabled,
  devDefaultEmail,
  safeDevReturnPath,
} from "../../dev-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!devAuthEnabled()) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const returnTo = safeDevReturnPath(url.searchParams.get("return_to"));
  const requestedEmail = url.searchParams.get("email");
  const email = (requestedEmail?.trim() || devDefaultEmail()).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return new Response("Invalid email", { status: 400 });
  }

  const cookie = [
    `${DEV_IDENTITY_COOKIE}=${encodeURIComponent(email)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${DEV_SESSION_MAX_AGE_SECONDS}`,
  ].join("; ");

  return new Response(null, {
    status: 302,
    headers: { Location: returnTo, "Set-Cookie": cookie },
  });
}
