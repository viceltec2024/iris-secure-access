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

/** Cabeceras de identidad que pone el proxy de ChatGPT Sites. */
export const IRIS_IDENTITY_HEADERS = [
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
] as const;

/**
 * Hosts en los que se confía en las cabeceras de identidad. Por defecto solo
 * el host de producción de Sites; IRIS_TRUSTED_HOSTS (lista separada por
 * comas) lo sustituye, por ejemplo para un dominio propio detrás de Sites.
 */
export function trustedIdentityHosts(configured = ""): string[] {
  const hosts = configured.split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  return hosts.length ? hosts : [new URL(IRIS_PRODUCTION_ORIGIN).hostname];
}

export function identityHeadersTrusted(hostname: string, trustedHosts: string[], allowLoopback: boolean): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (trustedHosts.includes(host)) return true;
  return allowLoopback && isLoopbackHost(host);
}

/**
 * Quita las cabeceras de identidad si la petición no llega por un host de
 * confianza. Solo el proxy de Sites puede ponerlas; si el Worker se alcanza
 * por otra URL (p. ej. *.workers.dev), cualquiera podría enviarlas y entrar
 * como otro usuario, incluido ADMIN.
 */
export function withoutUntrustedIdentity(request: Request, trustedHosts: string[], allowLoopback: boolean): Request {
  const present = IRIS_IDENTITY_HEADERS.some(name => request.headers.has(name));
  if (!present) return request;
  if (identityHeadersTrusted(new URL(request.url).hostname, trustedHosts, allowLoopback)) return request;
  const headers = new Headers(request.headers);
  for (const name of IRIS_IDENTITY_HEADERS) headers.delete(name);
  return new Request(request, { headers });
}
