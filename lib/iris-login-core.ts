/**
 * Inicio de sesión con correo y contraseña (sin ChatGPT): reglas puras.
 *
 * - Nunca se abre el registro: solo entran cuentas que ya tienen contraseña
 *   de IRIS. La primera contraseña del propietario necesita el código de
 *   configuración IRIS_SETUP_CODE, que solo el propietario pone en el
 *   entorno del Worker.
 * - Los errores de inicio de sesión son genéricos para no revelar qué
 *   correos existen.
 */

export const LOGIN_GENERIC_ERROR = "Correo o contraseña incorrectos.";
export const LOGIN_RATE_LIMITED_ERROR = "Demasiados intentos. Espera 15 minutos.";
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const SETUP_CODE_MIN_LENGTH = 16;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function normalizeLoginEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function validPasswordInput(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

/** Comparación en tiempo constante para el código de configuración. */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export type OwnerBootstrapDecision =
  | { allowed: true }
  | { allowed: false; reason: "setup_disabled" | "not_owner" | "bad_code" | "already_configured" | "weak_password" | "mismatch" };

/** ¿Puede el propietario crear su primera contraseña sin ChatGPT? */
export function ownerBootstrapAllowed(input: {
  email: string;
  ownerEmail: string;
  configuredSetupCode: string;
  providedSetupCode: string;
  passwordAlreadyConfigured: boolean;
  password: string;
  confirmation: string;
}): OwnerBootstrapDecision {
  const setupCode = input.configuredSetupCode.trim();
  if (setupCode.length < SETUP_CODE_MIN_LENGTH) return { allowed: false, reason: "setup_disabled" };
  const owner = input.ownerEmail.trim().toLowerCase();
  if (!owner || input.email !== owner) return { allowed: false, reason: "not_owner" };
  if (!timingSafeStringEqual(input.providedSetupCode.trim(), setupCode)) return { allowed: false, reason: "bad_code" };
  if (input.passwordAlreadyConfigured) return { allowed: false, reason: "already_configured" };
  if (input.password.length < 12 || input.password.length > 128) return { allowed: false, reason: "weak_password" };
  if (input.password !== input.confirmation) return { allowed: false, reason: "mismatch" };
  return { allowed: true };
}

export function ownerBootstrapMessage(reason: Exclude<OwnerBootstrapDecision, { allowed: true }>["reason"]): string {
  switch (reason) {
    case "weak_password": return "La contraseña debe tener entre 12 y 128 caracteres.";
    case "mismatch": return "Las contraseñas no coinciden.";
    case "already_configured": return "Ya existe una contraseña. Inicia sesión con ella.";
    // No distinguimos entre correo equivocado, código equivocado o
    // configuración apagada para no dar pistas a un atacante.
    default: return "No se pudo configurar el acceso. Revisa el correo y el código de configuración.";
  }
}

/** Solo se aceptan POST del mismo origen (defensa CSRF además de SameSite). */
export function sameOriginRequest(requestUrl: string, originHeader: string | null): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/** Cookie con el nonce del reto de Face ID / Touch ID para entrar sin ChatGPT. */
export const PASSKEY_LOGIN_COOKIE = "iris_passkey_login";
export const PASSKEY_LOGIN_TTL_SECONDS = 5 * 60;

/** Clave interna del reto: nunca coincide con un correo real. */
export function passkeyLoginChallengeKey(nonce: string): string | null {
  return /^[0-9a-f-]{36}$/.test(nonce) ? `passkey-login:${nonce}` : null;
}
