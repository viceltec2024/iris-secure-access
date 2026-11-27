// Regla de verificación reforzada (step-up) de IRIS, sin dependencias.
//
// Antes, la passkey/contraseña solo bloqueaba la página del dashboard: las
// rutas /api/* aceptaban cualquier petición con la identidad de ChatGPT. Esta
// misma regla decide ahora la página, las rutas de la API y la inscripción de
// nuevos factores, para que no haya un camino sin verificar.

export type StepUpState = {
  /** Solo en local: IRIS_DEV_SKIP_STEPUP=1 fuera de producción. */
  devSkip: boolean;
  /** El usuario tiene passkey o contraseña de IRIS. */
  factorEnrolled: boolean;
  /** Hay una sesión biométrica/contraseña válida para este usuario. */
  verified: boolean;
};

export const STEP_UP_REQUIRED_CODE = "step_up_required";

/**
 * Sin factor inscrito, el acceso no tiene step-up (mismo comportamiento que el
 * dashboard: se ofrece inscribir uno). Con un factor, hace falta verificarlo.
 */
export function stepUpSatisfied(state: StepUpState): boolean {
  return state.devSkip || !state.factorEnrolled || state.verified;
}

/**
 * Añadir una passkey o una contraseña cuando ya existe un factor exige haber
 * verificado el existente. Si no, quien tenga solo la sesión de ChatGPT
 * podría inscribir su propia passkey y saltarse el step-up.
 */
export function canEnrollFactor(state: StepUpState): boolean {
  return stepUpSatisfied(state);
}

export function stepUpRequiredBody(language: "es" | "en" = "es") {
  return {
    error: language === "en"
      ? "Verify your identity in IRIS (passkey or password) to continue."
      : "Verifica tu identidad en IRIS (clave de acceso o contraseña) para continuar.",
    code: STEP_UP_REQUIRED_CODE,
    stepUpRequired: true,
  };
}
