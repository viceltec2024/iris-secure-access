import { getChatGPTUser, irisSignInPath } from "./chatgpt-auth";
import { Buildings, LockKey, ShieldCheck, Pulse, Fingerprint } from "@phosphor-icons/react/dist/ssr";
import IrisBrandMark from "./iris-brand-mark";
import { devAuthEnabled } from "./dev-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const localAccess = !user && devAuthEnabled();
  const destination = user ? "/dashboard" : irisSignInPath("/dashboard");

  return (
    <main className="auth-shell iris-enterprise">
      <section className="brand-panel" aria-label="IRIS Enterprise security">
        <div className="brand-atmosphere" aria-hidden="true">
          <i className="brand-grid" />
          <i className="brand-orbit" />
          <i className="brand-orbit brand-orbit-2" />
          <i className="brand-scan" />
        </div>
        <div className="brand-content">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><IrisBrandMark size={88} /></div>
            <div><div className="brand-name">IRIS</div><div className="brand-edition">ENTERPRISE</div></div>
          </div>
          <div className="brand-message">
            <span className="accent-line" />
            <p className="brand-kicker">Centro de mando seguro</p>
            <h2>La consola de seguridad que habla, verifica y actúa.</h2>
            <p>Identidad protegida. Operaciones cifradas. Cada acceso se comprueba. Cada sesión queda registrada.</p>
          </div>
          <ul className="brand-trust">
            <li><Pulse weight="fill" /> SOC en vivo</li>
            <li><Fingerprint weight="fill" /> Identidad verificada</li>
            <li><LockKey weight="fill" /> Sesión cifrada</li>
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-content auth-glass">
          <div className="steps" aria-label="Autenticación segura">
            <div className="step active"><span className="step-circle">1</span><span>Identidad</span></div>
            <span className="step-line" />
            <div className="step"><span className="step-circle">2</span><span>Acceso</span></div>
          </div>

          <div className="auth-form platform-auth">
            <div className="heading">
              <h1>Acceso seguro</h1>
              <p>{user ? "Tu identidad ya está verificada. Entra al centro de operaciones." : localAccess ? "El acceso local está activo. Entra al centro de operaciones IRIS sin ChatGPT." : "Entra con tu identidad de ChatGPT. OpenAI protege la cuenta y aplica el segundo factor."}</p>
            </div>

            <div className="security-summary">
              <ShieldCheck weight="duotone" />
              <div><strong>Identidad protegida por OpenAI</strong><span>IRIS no guarda ni transmite una contraseña propia.</span></div>
            </div>

            {user && <p className="signed-in-note">Sesión iniciada como <strong>{user.email}</strong></p>}

            <a className="primary-button auth-link" href={destination}>
              <Buildings weight="duotone" />
              <span>{user ? "Entrar al espacio IRIS" : localAccess ? "Entrar al espacio IRIS" : "Continuar con ChatGPT"}</span>
            </a>
            <p className="auth-disclosure">Al continuar, IRIS recibe solo tu identidad verificada. Los permisos se aplican en el servidor.</p>
          </div>

          <footer className="secure-footer"><span><LockKey weight="fill" /> Sesión cifrada</span><span className="footer-divider" /><a href="#privacy">Privacidad</a></footer>
        </div>
      </section>
    </main>
  );
}
