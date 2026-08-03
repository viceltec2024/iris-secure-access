import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import { listRecentAudit, provisionIrisUser } from "../../lib/authz";
import { ShieldCheck, SignOut, UserCircle, LockKey, Pulse, UsersThree } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const identity = await requireChatGPTUser("/dashboard");
  const user = await provisionIrisUser(identity);

  if (user.status !== "ACTIVE") {
    return <main className="blocked-state"><ShieldCheck weight="fill" /><h1>Access suspended</h1><p>Contact an IRIS administrator to restore access.</p><a href={chatGPTSignOutPath("/")}>Sign out</a></main>;
  }

  const events = await listRecentAudit(user.email, user.role);

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand"><ShieldCheck weight="duotone" /><div><strong>IRIS</strong><span>ENTERPRISE</span></div></div>
        <nav aria-label="Workspace navigation"><a className="nav-active" href="/dashboard"><Pulse /> Security overview</a>{user.role === "ADMIN" && <a href="/admin/users"><UsersThree /> Manage users</a>}</nav>
        <div className="workspace-user"><UserCircle /><div><strong>{user.displayName || user.email}</strong><span>{user.role}</span></div></div>
      </aside>
      <section className="workspace-main">
        <header className="workspace-header"><div><p>Secure workspace</p><h1>Welcome to IRIS</h1></div><a className="signout-link" href={chatGPTSignOutPath("/")}><SignOut /> Sign out</a></header>
        <section className="trust-banner"><ShieldCheck weight="fill" /><div><strong>Identity verified</strong><span>Authenticated by ChatGPT · Server-enforced {user.role} permissions</span></div></section>
        <div className="workspace-grid">
          <section className="workspace-panel"><div className="panel-title"><LockKey /><div><h2>Access policy</h2><p>Your active authorization context</p></div></div><dl><div><dt>Identity</dt><dd>{user.email}</dd></div><div><dt>Role</dt><dd><span className="role-badge">{user.role}</span></dd></div><div><dt>Status</dt><dd className="status-active">Active</dd></div><div><dt>MFA</dt><dd>Managed by OpenAI</dd></div></dl></section>
          <section className="workspace-panel audit-panel"><div className="panel-title"><Pulse /><div><h2>Audit activity</h2><p>{user.role === "ADMIN" ? "Organization-wide security events" : "Your recent security events"}</p></div></div><div className="audit-list">{events.map((event) => <article key={event.id}><span className={`event-dot ${event.outcome.toLowerCase()}`} /><div><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actorEmail} · {event.resource}</span></div><time>{new Date(event.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time></article>)}</div></section>
        </div>
      </section>
    </main>
  );
}
