import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser, safeIrisReturnPath } from "../chatgpt-auth";
import { devAuthEnabled } from "../dev-auth";
import IrisBrandMark from "../iris-brand-mark";
import IrisLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function IniciarSesion({ searchParams }: { searchParams: Promise<{ return_to?: string }> }) {
  const params = await searchParams;
  const returnTo = safeIrisReturnPath(params.return_to);
  if (await getChatGPTUser()) redirect(returnTo);

  return <main className="iris-login">
    <section className="iris-login-card" aria-labelledby="iris-login-title">
      <div className="iris-login-brand"><IrisBrandMark size={44} /><span>IRIS</span></div>
      <h1 id="iris-login-title">Iniciar sesión</h1>
      <p>Entra con tu correo y tu contraseña de IRIS, o con Face ID en el iPhone y Touch ID en el Mac.</p>
      <IrisLoginForm returnTo={returnTo} />
      <div className="iris-login-divider"><span>o</span></div>
      <a className="iris-login-chatgpt" href={devAuthEnabled() ? `/dev/sign-in?return_to=${encodeURIComponent(returnTo)}` : chatGPTSignInPath(returnTo)}>Entrar con ChatGPT</a>
    </section>
  </main>;
}
