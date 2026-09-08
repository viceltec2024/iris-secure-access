export const IRIS_PRODUCTION_ORIGIN = "https://iris-secure-access.taylor-667.chatgpt.site";

export function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
}

export function isPrivateLanHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return /^(10|192\.168|172\.(1[6-9]|2\d|3[0-1]))\./.test(host);
}

export function irisReconnectOrigin(pageOrigin: string, publicOrigin = "") {
  const configured = publicOrigin.trim().replace(/\/$/, "");
  let configuredOrigin = "";
  if (configured) {
    try { configuredOrigin = new URL(configured).origin; } catch { /* ignore invalid override */ }
  }
  try {
    const page = new URL(pageOrigin);
    const loopback = isLoopbackHost(page.hostname);
    const lan = isPrivateLanHost(page.hostname);
    if (!loopback && !lan) return page.origin;
    if (configuredOrigin) return configuredOrigin;
    if (lan) return page.origin;
    return IRIS_PRODUCTION_ORIGIN;
  } catch {
    return configuredOrigin || IRIS_PRODUCTION_ORIGIN;
  }
}

export function passkeyRelyingParty(requestUrl: string) {
  const url = new URL(requestUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const rpID = hostname === "::1" ? "localhost" : hostname;
  return { rpID, origin: url.origin, secureCookie: url.protocol === "https:" };
}

export function isPublicAgentPath(pathname: string) {
  return pathname === "/api/agent/check-in" || pathname.startsWith("/iris-agent-macos.sh");
}
