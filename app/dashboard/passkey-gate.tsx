"use client";

import { useEffect, useState, type ReactNode } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, LockKey, ShieldCheck } from "@phosphor-icons/react";

type Props = { enrolled: boolean; verified: boolean; signOutPath: string; children: ReactNode };

export default function PasskeyGate({ enrolled, verified, signOutPath, children }: Props) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setSupported).catch(() => setSupported(false));
  }, []);

  async function run(mode: "register" | "auth") {
    setBusy(true); setError("");
    try {
      const optionsResponse = await fetch(`/api/passkeys/${mode === "register" ? "register" : "auth"}/options`, { method: "POST" });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error || "No se pudo iniciar Touch ID");
      const credential = mode === "register"
        ? await startRegistration({ optionsJSON: options })
        : await startAuthentication({ optionsJSON: options });
      const verifyResponse = await fetch(`/api/passkeys/${mode === "register" ? "register" : "auth"}/verify`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(credential),
      });
      const result = await verifyResponse.json();
      if (!verifyResponse.ok || !result.verified) throw new Error(result.error || "Touch ID no pudo verificarse");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "NotAllowedError" ? cause.message : "La verificación fue cancelada o no se completó.");
      setBusy(false);
    }
  }

  if (enrolled && !verified) return (
    <main className="passkey-lock">
      <section className="passkey-card">
        <div className="passkey-mark"><LockKey weight="fill" /></div>
        <span>IRIS · ACCESO PROTEGIDO</span>
        <h1>Verifica que eres tú</h1>
        <p>Usa Touch ID en tu Mac para abrir el centro de seguridad.</p>
        <button onClick={() => run("auth")} disabled={busy || supported === false}><Fingerprint weight="bold" />{busy ? "Verificando…" : "Verificar con Touch ID"}</button>
        {supported === false && <small>Touch ID no está disponible en este navegador. Usa Safari o Chrome en tu Mac.</small>}
        {error && <small className="passkey-error">{error}</small>}
        <a href={signOutPath}>Recuperar acceso con otra cuenta de ChatGPT</a>
      </section>
    </main>
  );

  return <>
    {!enrolled && <aside className="passkey-enroll">
      <ShieldCheck weight="fill" />
      <div><strong>Protege IRIS con Touch ID</strong><span>Tu huella permanece en tu Mac. IRIS solo recibe una prueba criptográfica.</span>{error && <small>{error}</small>}</div>
      <button onClick={() => run("register")} disabled={busy || supported === false}><Fingerprint weight="bold" />{busy ? "Configurando…" : "Configurar Touch ID"}</button>
    </aside>}
    {children}
  </>;
}
