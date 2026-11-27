import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import { listRecentAudit, provisionIrisUser } from "../../lib/authz";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { redirect } from "next/navigation";
import SecurityOperations from "./security-operations";
import PasskeyGate from "./passkey-gate";
import LocalConnect from "../local-connect";
import { dashboardDeviceBootstrap } from "../../lib/iris-dashboard-bootstrap";
import { passkeysFor } from "../../lib/passkeys";
import { stepUpState } from "../../lib/iris-step-up";
import { passwordConfigured } from "../../lib/passwords";
import { devAuthEnabled } from "../dev-auth";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const identity = await getChatGPTUser();
  if (!identity) {
    if (devAuthEnabled()) return <LocalConnect returnTo="/dashboard" />;
    redirect(chatGPTSignInPath("/dashboard"));
  }
  const user = await provisionIrisUser(identity);

  if (user.status !== "ACTIVE") {
    return <main className="blocked-state"><ShieldCheck weight="fill" /><h1>Access suspended</h1><p>Contact an IRIS administrator to restore access.</p><a href={chatGPTSignOutPath("/")}>Sign out</a></main>;
  }

  const events = await listRecentAudit(user.email, user.role);
  const bootstrap = await dashboardDeviceBootstrap(user);
  const passkeyEnrolled = (await passkeysFor(user.email)).length > 0;
  const hasPassword = await passwordConfigured(user.email);
  // Misma regla que las rutas /api/* (lib/iris-step-up.ts).
  const stepUp = await stepUpState(user.email);
  const skipStepUp = stepUp.devSkip;
  const verified = stepUp.verified;
  const signOutPath = skipStepUp ? "/dev/sign-out?return_to=/" : chatGPTSignOutPath("/");
  return <PasskeyGate passkeyEnrolled={passkeyEnrolled} passwordConfigured={hasPassword} verified={verified} signOutPath={signOutPath} devSkipStepUp={skipStepUp}>
    <SecurityOperations user={{ email: user.email, displayName: user.displayName || user.email, role: user.role }} auditCount={events.length} signOutPath={signOutPath} initialDevices={bootstrap.devices} initialAgentOrigin={bootstrap.agentOrigin} />
  </PasskeyGate>;
}
