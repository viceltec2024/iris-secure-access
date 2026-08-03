import { redirect } from "next/navigation";
import { requireChatGPTUser, chatGPTSignOutPath } from "../../chatgpt-auth";
import { listUserAuditForAdmin, listUsersForAdmin, logAudit, provisionIrisUser } from "../../../lib/authz";
import { ShieldCheck, SignOut, UserCircle, Pulse, UsersThree, ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { AccessForm } from "./access-form";

export const dynamic = "force-dynamic";

export default async function ManageUsersPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const identity = await requireChatGPTUser("/admin/users");
  const actor = await provisionIrisUser(identity);
  if (actor.role !== "ADMIN" || actor.status !== "ACTIVE") {
    await logAudit(actor.email, "ADMIN_USERS_OPENED", "user_directory", "DENIED");
    redirect("/dashboard");
  }
  const params = await searchParams;
  const selectedEmail = params.user?.trim().toLowerCase();
  const [directory, events] = await Promise.all([listUsersForAdmin(actor.email, actor.role), listUserAuditForAdmin(actor.email, actor.role, selectedEmail)]);

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand"><ShieldCheck weight="duotone" /><div><strong>IRIS</strong><span>ENTERPRISE</span></div></div>
        <nav aria-label="Workspace navigation"><a href="/dashboard"><Pulse /> Security overview</a><a className="nav-active" href="/admin/users"><UsersThree /> Manage users</a></nav>
        <div className="workspace-user"><UserCircle /><div><strong>{actor.displayName || actor.email}</strong><span>{actor.role}</span></div></div>
      </aside>
      <section className="workspace-main">
        <header className="workspace-header"><div><p>Access administration</p><h1>Manage users</h1></div><a className="signout-link" href={chatGPTSignOutPath("/")}><SignOut /> Sign out</a></header>
        <section className="trust-banner"><ShieldCheck weight="fill" /><div><strong>Administrator controls</strong><span>Role and status changes are enforced on the server and recorded in the audit log.</span></div></section>
        <section className="user-directory workspace-panel">
          <div className="panel-title"><UsersThree /><div><h2>User directory</h2><p>{directory.length} registered {directory.length === 1 ? "account" : "accounts"}</p></div></div>
          <div className="user-table-wrap"><table><thead><tr><th>User</th><th>Last active</th><th>Access controls</th><th>Audit</th></tr></thead><tbody>{directory.map((user) => <tr key={user.id}><td><strong>{user.displayName || "IRIS user"}</strong><span>{user.email}</span></td><td>{new Date(user.lastSeenAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td><td><AccessForm email={user.email} role={user.role} status={user.status} isSelf={user.email === actor.email} /></td><td><a className="audit-link" href={`/admin/users?user=${encodeURIComponent(user.email)}`}>View activity</a></td></tr>)}</tbody></table></div>
        </section>
        <section className="workspace-panel admin-audit"><div className="panel-title"><Pulse /><div><h2>{selectedEmail ? `Activity: ${selectedEmail}` : "Recent organization activity"}</h2><p>Immutable administrative and authentication events</p></div>{selectedEmail && <a href="/admin/users"><ArrowLeft /> Show all</a>}</div><div className="audit-list">{events.length ? events.map((event) => <article key={event.id}><span className={`event-dot ${event.outcome.toLowerCase()}`} /><div><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.actorEmail} · {event.resource}</span></div><time>{new Date(event.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</time></article>) : <p className="empty-audit">No activity recorded for this user.</p>}</div></section>
      </section>
    </main>
  );
}
