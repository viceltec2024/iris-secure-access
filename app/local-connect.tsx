export default function LocalConnect({ returnTo }: { returnTo: string }) {
  const href = `/dev/sign-in?return_to=${encodeURIComponent(returnTo)}`;
  return (
    <main className="auth-shell iris-phone-connect">
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
      <section className="auth-panel">
        <p>Conectando con IRIS…</p>
        <a className="primary-button auth-link" href={href}>Entrar desde el teléfono</a>
      </section>
    </main>
  );
}
