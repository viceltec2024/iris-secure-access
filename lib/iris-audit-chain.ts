/** Hash de un evento de auditoría (puro; lo usan logAudit y la verificación de la cadena). */
export async function auditEventHash(
  previousHash: string,
  actorEmail: string,
  organizationId: string | null | undefined,
  action: string,
  resource: string,
  outcome: "SUCCESS" | "DENIED",
  metadata: string,
): Promise<string> {
  const material = JSON.stringify({
    previousHash,
    actorEmail,
    organizationId: organizationId || null,
    action,
    resource,
    outcome,
    metadata,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
