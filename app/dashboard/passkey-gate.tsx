"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Key, LockKey, ShieldCheck } from "@phosphor-icons/react";

type Props = { passkeyEnrolled: boolean; passwordConfigured: boolean; verified: boolean; signOutPath: string; children: ReactNode };

export default function PasskeyGate({ passkeyEnrolled, passwordConfigured, verified, signOutPath, children }: Props) {
  const [platformAuthenticatorAvailable, setPlatformAuthenticatorAvailable] = useState<boolean | null>(null);
  const [webAuthnAvailable, setWebAuthnAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (!("PublicKeyCredential" in window)) {
      setWebAuthnAvailable(false);
      setPlatformAuthenticatorAvailable(false);
      return;
    }
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then(setPlatformAuthenticatorAvailable)
      .catch(() => setPlatformAuthenticatorAvailable(false));
  }, []);

  async function runPasskey(mode: "register" | "auth") {
    setBusy(true); setError("");
    try {
      const optionsResponse = await fetch(`/api/passkeys/${mode === "register" ? "register" : "auth"}/options`, { method: "POST" });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error || "No se pudo iniciar Touch ID");
      const credential = mode === "register" ? await startRegistration({ optionsJSON: options }) : await startAuthentication({ optionsJSON: options });
      const verifyResponse = await fetch(`/api/passkeys/${mode === "register" ? "register" : "auth"}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credential) });
      const result = await verifyResponse.json();
      if (!verifyResponse.ok || !result.verified) throw new Error(result.error || "Touch ID no pudo verificarse");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "NotAllowedError" ? cause.message : "La verificación fue cancelada o no se completó."); setBusy(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(passwordConfigured ? "/api/password/verify" : "/api/password/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(passwordConfigured ? { password } : { password, confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo verificar la contraseña.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo verificar la contraseña."); setBusy(false); }
  }

  if ((passkeyEnrolled || passwordConfigured) && !verified) return <main className="passkey-lock"><section className="passkey-card">
    <div className="passkey-mark"><LockKey weight="fill" /></div><span>IRIS · ACCESO PROTEGIDO</span><h1>Verifica que eres tú</h1>
    {passwordConfigured && <form className="iris-password-form" onSubmit={submitPassword}><label htmlFor="iris-password">Contraseña de IRIS</label><input id="iris-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={128} autoFocus /><button type="submit" disabled={busy}><Key weight="bold" />{busy ? "Verificando…" : "Entrar con contraseña"}</button></form>}
    {passkeyEnrolled && <><div className="passkey-divider"><span>o</span></div><button onClick={() => runPasskey("auth")} disabled={busy || !webAuthnAvailable}><Fingerprint weight="bold" />Verificar con clave de acceso</button>{platformAuthenticatorAvailable === false && webAuthnAvailable && <small className="passkey-hint">Touch ID no está disponible aquí. Continúa con una passkey de tu teléfono o una llave de seguridad.</small>}{!webAuthnAvailable && <small className="passkey-error">Este navegador no admite claves de acceso. Abre IRIS en Safari o Chrome.</small>}</>}
    {error && <small className="passkey-error">{error}</small>}<a href={signOutPath}>Cerrar sesión de ChatGPT</a>
  </section></main>;

  return <>{!passkeyEnrolled && !passwordConfigured && <aside className={`passkey-enroll ${showPasswordSetup ? "password-open" : ""}`}>
    <ShieldCheck weight="fill" /><div><strong>Protege el acceso a IRIS</strong><span>Elige Touch ID o crea una contraseña privada de IRIS.</span>{error && <small>{error}</small>}</div>
    {!showPasswordSetup ? <div className="passkey-choice"><button onClick={() => runPasskey("register")} disabled={busy || !webAuthnAvailable}><Fingerprint weight="bold" />Crear clave de acceso</button><button onClick={() => { setError(""); setShowPasswordSetup(true); }}><Key weight="bold" />Crear contraseña</button></div>
    : <form className="password-setup-form" onSubmit={submitPassword}><input type="password" autoComplete="new-password" placeholder="Contraseña (mínimo 12 caracteres)" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required /><input type="password" autoComplete="new-password" placeholder="Repetir contraseña" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /><button type="submit" disabled={busy}><Key weight="bold" />{busy ? "Guardando…" : "Guardar contraseña"}</button><button type="button" className="password-cancel" onClick={() => setShowPasswordSetup(false)}>Cancelar</button></form>}
  </aside>}{children}</>;
}
