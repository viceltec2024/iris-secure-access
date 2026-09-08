export default function LocalConnect({ returnTo }: { returnTo: string }) {
  const href = `/dev/sign-in?return_to=${encodeURIComponent(returnTo)}`;
  return (
    <main className="auth-shell">
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
      <section className="auth-panel">
        <p>Connecting to IRIS…</p>
        <a className="primary-button auth-link" href={href}>Continue</a>
      </section>
    </main>
  );
}
