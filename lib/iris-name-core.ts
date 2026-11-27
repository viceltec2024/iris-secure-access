/**
 * Cómo llama Ask IRIS a cada usuario (puro).
 *
 * Orden: el nombre que el usuario pidió ("llámame Ana") → el nombre de su
 * cuenta de ChatGPT → la parte local del correo, legible → "operador".
 */

const NAME_RE = /^[\p{L}][\p{L}\p{M}' .-]{0,38}[\p{L}\p{M}]$|^[\p{L}]$/u;
const COMMAND_RE = /^(?:por favor,?\s+)?(?:ll[aá]mame|me llamo|mi nombre es|dime|call me|my name is)\s+(.+?)[\s.!]*$/iu;
const NOT_A_NAME = new Set(["iris", "admin", "administrador", "root", "system", "sistema", "usuario", "user", "nadie", "nobody"]);

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

/** Nombre válido para guardar: solo letras (con acentos), espacios, guion y apóstrofo. */
export function cleanPreferredName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 40 || !NAME_RE.test(name)) return null;
  if (NOT_A_NAME.has(name.toLocaleLowerCase())) return null;
  return titleCase(name);
}

/**
 * Detecta "llámame Ana", "me llamo Ana López", "call me Ana". Devuelve
 * `null` si no es una orden de nombre o si el nombre no es válido.
 * "dime" solo cuenta en la forma "dime Ana" de una sola palabra, para no
 * confundir "dime el estado del Mac".
 */
export function extractNameCommand(text: string): string | null {
  const trimmed = String(text || "").trim();
  if (trimmed.length > 80) return null;
  const match = trimmed.match(COMMAND_RE);
  if (!match) return null;
  const candidate = match[1].replace(/^["'«“]|["'»”]$/g, "").trim();
  if (/^dime\b/i.test(trimmed) && candidate.includes(" ")) return null;
  return cleanPreferredName(candidate);
}

function nameFromEmail(email: string): string | null {
  const local = String(email || "").split("@")[0] || "";
  const words = local.replace(/[0-9]+/g, " ").split(/[._+\-\s]+/).filter(word => word.length >= 2);
  if (!words.length) return null;
  const first = words[0];
  if (NOT_A_NAME.has(first.toLowerCase()) || first.toLowerCase() === "owner") return null;
  return cleanPreferredName(first);
}

export function friendlyName(input: { preferred?: string | null; displayName?: string | null; email: string }): string {
  const preferred = cleanPreferredName(input.preferred || "");
  if (preferred) return preferred;
  const display = String(input.displayName || "").trim();
  if (display && !display.includes("@")) {
    const first = cleanPreferredName(display.split(/\s+/)[0]);
    if (first) return first;
  }
  return nameFromEmail(input.email) || "operador";
}

export function nameSavedReply(name: string, language: "es" | "en" = "es") {
  return language === "en"
    ? `Done, from now on I'll call you ${name}.`
    : `Listo, desde ahora te llamaré ${name}.`;
}

export function preferredNameKey(email: string) {
  return `iris_preferred_name:${email.trim().toLowerCase()}`;
}
