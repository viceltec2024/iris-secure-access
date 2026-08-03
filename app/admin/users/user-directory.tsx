"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { AccessForm } from "./access-form";

type DirectoryUser = {
  id: number;
  email: string;
  displayName: string | null;
  role: "ADMIN" | "USER";
  status: "ACTIVE" | "SUSPENDED";
  lastSeenAt: string;
};

export function UserDirectory({ users, actorEmail }: { users: DirectoryUser[]; actorEmail: string }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText = !normalizedQuery || user.email.toLowerCase().includes(normalizedQuery) || (user.displayName || "").toLowerCase().includes(normalizedQuery);
      const matchesRole = role === "ALL" || user.role === role;
      const matchesStatus = status === "ALL" || user.status === status;
      return matchesText && matchesRole && matchesStatus;
    });
  }, [users, query, role, status]);

  const hasFilters = Boolean(query || role !== "ALL" || status !== "ALL");
  function clearFilters() { setQuery(""); setRole("ALL"); setStatus("ALL"); }

  return <>
    <div className="directory-filters" aria-label="Filter users">
      <label className="directory-search"><span>Search users</span><div><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></div></label>
      <label><span>Filter by role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="ALL">All roles</option><option value="ADMIN">Admin</option><option value="USER">User</option></select></label>
      <label><span>Filter by status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></select></label>
      {hasFilters && <button type="button" className="clear-filters" onClick={clearFilters}><X /> Clear</button>}
      <p aria-live="polite"><strong>{filteredUsers.length}</strong> of {users.length} users shown</p>
    </div>
    <div className="user-table-wrap"><table><thead><tr><th>User</th><th>Last active</th><th>Access controls</th><th>Audit</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><strong>{user.displayName || "IRIS user"}</strong><span>{user.email}</span></td><td>{new Date(user.lastSeenAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</td><td><AccessForm email={user.email} role={user.role} status={user.status} isSelf={user.email === actorEmail} /></td><td><a className="audit-link" href={`/admin/users?user=${encodeURIComponent(user.email)}`}>View activity</a></td></tr>)}</tbody></table>{filteredUsers.length === 0 && <div className="directory-empty"><MagnifyingGlass /><strong>No users match these filters</strong><span>Try another search, role, or status.</span><button type="button" onClick={clearFilters}>Clear filters</button></div>}</div>
  </>;
}
