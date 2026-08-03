import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import { listRecentAudit, provisionIrisUser } from "../../lib/authz";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import SecurityOperations from "./security-operations";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const identity = await requireChatGPTUser("/dashboard");
  const user = await provisionIrisUser(identity);

  if (user.status !== "ACTIVE") {
    return <main className="blocked-state"><ShieldCheck weight="fill" /><h1>Access suspended</h1><p>Contact an IRIS administrator to restore access.</p><a href={chatGPTSignOutPath("/")}>Sign out</a></main>;
  }

  const events = await listRecentAudit(user.email, user.role);
  return <SecurityOperations user={{ email: user.email, displayName: user.displayName || user.email, role: user.role }} auditCount={events.length} signOutPath={chatGPTSignOutPath("/")} />;
}
