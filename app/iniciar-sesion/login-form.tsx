"use client";

/* eslint-disable react-hooks/set-state-in-effect -- WebAuthn availability is probed after mount */
import { useEffect, useState, type FormEvent } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

type Mode = "login" | "setup";

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { error?: string; signedIn?: boolean };
  if (!response.ok) throw new Error(payload.error || "No se pudo iniciar sesión.");
  return payload;
}

export default function IrisLoginForm({ returnTo }: { returnTo: string }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [faceIdLabel, setFaceIdLabel] = useState("Entrar con Face ID / Touch ID");
  const [webAuthn, setWebAuthn] = useState(true);

  useEffect(() => {
    const available = typeof window !== "undefined" && "PublicKeyCredential" in window;
    setWebAuthn(available);
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) setFaceIdLabel("Entrar con Face ID");
    else if (/Macintosh/.test(ua)) setFaceIdLabel("Entrar con Touch ID");
  }, []);

  function done() {
    window.location.assign(returnTo);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await postJson("/api/session/login", { email, password });
      else await postJson("/api/session/setup-owner", { email, setupCode, password, confirmation });
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
      setPassword("");
      setConfirmation("");
      setBusy(false);
    }
  }

  async function faceId() {
    setBusy(true);
    setError("");
    try {
      const options = await postJson("/api/session/passkey/options", { email: email.trim() || undefined });
      const credential = await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      await postJson("/api/session/passkey/verify", credential);
      done();
    } catch (cause) {
      const cancelled = cause instanceof Error && cause.name === "NotAllowedError";
      setError(cancelled ? "La verificación se canceló." : cause instanceof Error ? cause.message : "No se pudo verificar.");
      setBusy(false);
    }
  }

  return <div className="iris-login-form">
    <button type="button" className="iris-login-faceid" onClick={() => void faceId()} disabled={busy || !webAuthn}>{faceIdLabel}</button>
    {!webAuthn && <small className="iris-login-hint">Este navegador no admite Face ID ni Touch ID. Abre IRIS en Safari.</small>}
    <div className="iris-login-divider"><span>o con contraseña</span></div>
    <form onSubmit={submit}>
      <label htmlFor="login-email">Correo</label>
      <input id="login-email" type="email" autoComplete="username webauthn" inputMode="email" autoCapitalize="none" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} />
      {mode === "setup" && <>
        <label htmlFor="login-code">Código de configuración</label>
        <input id="login-code" type="password" autoComplete="one-time-code" value={setupCode} onChange={event => setSetupCode(event.target.value)} required maxLength={200} />
      </>}
      <label htmlFor="login-password">{mode === "setup" ? "Nueva contraseña (mínimo 12 caracteres)" : "Contraseña"}</label>
      <input id="login-password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === "setup" ? 12 : 1} maxLength={128} />
      {mode === "setup" && <>
        <label htmlFor="login-confirm">Repetir contraseña</label>
        <input id="login-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={128} />
      </>}
      <button type="submit" disabled={busy}>{busy ? "Verificando…" : mode === "setup" ? "Crear contraseña y entrar" : "Iniciar sesión"}</button>
    </form>
    {error && <p className="iris-login-error" role="alert">{error}</p>}
    <button type="button" className="iris-login-link" onClick={() => { setMode(mode === "login" ? "setup" : "login"); setError(""); }}>
      {mode === "login" ? "¿Primer acceso del propietario? Configura tu contraseña" : "Ya tengo contraseña"}
    </button>
  </div>;
}
