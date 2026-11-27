import "server-only";

import { devAuthEnabled } from "../app/dev-auth";
import { isBiometricVerified, passkeysFor } from "./passkeys";
import { passwordConfigured } from "./passwords";
import { canEnrollFactor, stepUpRequiredBody, stepUpSatisfied, type StepUpState } from "./iris-step-up-core";

export async function stepUpState(email: string): Promise<StepUpState> {
  const devSkip = devAuthEnabled();
  if (devSkip) return { devSkip, factorEnrolled: false, verified: true };
  const [passkeys, hasPassword] = await Promise.all([passkeysFor(email), passwordConfigured(email)]);
  const factorEnrolled = passkeys.length > 0 || hasPassword;
  const verified = factorEnrolled ? await isBiometricVerified(email) : false;
  return { devSkip, factorEnrolled, verified };
}

/**
 * Devuelve `null` si la petición puede seguir, o una respuesta 403 con
 * `code: "step_up_required"` si el usuario tiene un factor y no lo verificó.
 */
export async function requireStepUp(email: string, language: "es" | "en" = "es"): Promise<Response | null> {
  if (stepUpSatisfied(await stepUpState(email))) return null;
  return Response.json(stepUpRequiredBody(language), { status: 403 });
}

/**
 * Para inscribir una passkey o crear la contraseña: si ya hay un factor,
 * hay que haberlo verificado antes (ver canEnrollFactor).
 */
export async function requireFactorEnrollment(email: string): Promise<Response | null> {
  if (canEnrollFactor(await stepUpState(email))) return null;
  return Response.json(stepUpRequiredBody("es"), { status: 403 });
}

/** Un usuario suspendido no puede verificar ni inscribir factores. */
export function suspendedResponse(status: string): Response | null {
  return status === "ACTIVE" ? null : Response.json({ error: "El acceso a IRIS está suspendido." }, { status: 403 });
}
