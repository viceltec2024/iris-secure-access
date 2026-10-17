/**
 * Secret hygiene helpers — never put raw API keys in responses or logs.
 */

const SECRET_PATTERNS = [
  /\bsk-[a-zA-Z0-9]{16,}\b/g,
  /\bsk_(?:live|test)_[a-zA-Z0-9]{16,}\b/g,
  /\bLLM\|[^\s"']{8,}\b/g,
  /\b(OPENAI|ELEVENLABS|MODEL|MUSE|STRIPE)_API_KEY\s*[:=]\s*["']?[^"'\s]+/gi,
];

export function containsPossibleSecret(value: string) {
  return SECRET_PATTERNS.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export function redactSecrets(value: string) {
  let next = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, "[REDACTED]");
  }
  return next;
}

export function assertNoSecretsInPayload(payload: unknown, label = "payload") {
  const blob = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (containsPossibleSecret(blob)) {
    throw new Error(`Secret material detected in ${label}`);
  }
  return true;
}

export function maskSecretPresence(value: string | undefined | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return { configured: false as const, hint: null as string | null };
  const hint = trimmed.length <= 8 ? `${trimmed.slice(0, 2)}…` : `${trimmed.slice(0, 4)}…${trimmed.slice(-2)}`;
  return { configured: true as const, hint };
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string, bytes = 24) {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}${raw}`;
}
