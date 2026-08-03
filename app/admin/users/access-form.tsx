"use client";

import { useActionState } from "react";
import { changeUserAccess, type AccessActionState } from "./actions";

const initialState: AccessActionState = { ok: false, message: "" };

export function AccessForm({ email, role, status, isSelf }: { email: string; role: "ADMIN" | "USER"; status: "ACTIVE" | "SUSPENDED"; isSelf: boolean }) {
  const [state, action, pending] = useActionState(changeUserAccess, initialState);
  return (
    <form action={action} className="access-form">
      <input type="hidden" name="targetEmail" value={email} />
      <label><span>Role</span><select name="role" defaultValue={role} disabled={isSelf || pending}><option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></label>
      <label><span>Status</span><select name="status" defaultValue={status} disabled={isSelf || pending}><option value="ACTIVE">ACTIVE</option><option value="SUSPENDED">SUSPENDED</option></select></label>
      {isSelf && <input type="hidden" name="role" value="ADMIN" />}
      {isSelf && <input type="hidden" name="status" value="ACTIVE" />}
      <button type="submit" disabled={isSelf || pending}>{pending ? "Saving…" : isSelf ? "Current admin" : "Save access"}</button>
      {state.message && <p className={state.ok ? "action-success" : "action-error"} role="status">{state.message}</p>}
    </form>
  );
}
