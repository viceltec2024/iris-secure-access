import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { Buildings, LockKey, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  const destination = user ? "/dashboard" : chatGPTSignInPath("/dashboard");

  return (
    <main className="auth-shell">
      <section className="brand-panel" aria-label="IRIS Enterprise security">
        <div className="brand-content">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><ShieldCheck weight="duotone" /></div>
            <div><div className="brand-name">IRIS</div><div className="brand-edition">ENTERPRISE</div></div>
          </div>
          <div className="brand-message">
            <span className="accent-line" />
            <h2>Secure Command Gateway</h2>
            <p>Trusted AI oversight. Protected operations.<br />Every access is verified. Every session<br />is encrypted. Your mission is our priority.</p>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-content">
          <div className="steps" aria-label="Secure authentication">
            <div className="step active"><span className="step-circle">1</span><span>Identify</span></div>
            <span className="step-line" />
            <div className="step"><span className="step-circle">2</span><span>Access</span></div>
          </div>

          <div className="auth-form platform-auth">
            <div className="heading">
              <h1>Secure access</h1>
              <p>Sign in with your ChatGPT identity. OpenAI protects your account and handles multi-factor authentication.</p>
            </div>

            <div className="security-summary">
              <ShieldCheck weight="duotone" />
              <div><strong>Identity protected by OpenAI</strong><span>No IRIS password is stored or transmitted.</span></div>
            </div>

            {user && <p className="signed-in-note">Signed in as <strong>{user.email}</strong></p>}

            <a className="primary-button auth-link" href={destination}>
              <Buildings weight="duotone" />
              <span>{user ? "Enter IRIS workspace" : "Continue with ChatGPT"}</span>
            </a>
            <p className="auth-disclosure">By continuing, IRIS receives only your verified account identity. Permissions are enforced on the server.</p>
          </div>

          <footer className="secure-footer"><span><LockKey weight="fill" /> Encrypted session</span><span className="footer-divider" /><a href="#privacy">Privacy</a></footer>
        </div>
      </section>
    </main>
  );
}
