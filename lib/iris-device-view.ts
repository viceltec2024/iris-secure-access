export const ONLINE_WINDOW_MS = 5 * 60 * 1000;
export const IRIS_AGENT_SCRIPT_VERSION = 36;

export type AgentTelemetry = {
  hostname?: string;
  osVersion?: string;
  architecture?: string;
  diskUsedPercent?: number;
  memoryUsedPercent?: number;
  firewallEnabled?: boolean;
  gatekeeperEnabled?: boolean;
  fileVaultEnabled?: boolean;
  sipEnabled?: boolean;
  automaticUpdatesEnabled?: boolean;
  installedApplicationCount?: number;
  riskyApplications?: string[];
  trustedApplications?: string[];
  xProtectPresent?: boolean;
  xProtectVersion?: string;
  malwareRemovalToolPresent?: boolean;
  persistenceItemCount?: number;
  unsignedPersistenceItems?: string[];
  securityFindings?: string[];
  changes?: string[];
  changeDetectedAt?: string;
  collectedAt?: string;
  transportEncryption?: "TLS+HMAC" | "AES-256-CBC+HMAC-SHA256";
};

export type DeviceRecord = {
  id: string;
  name: string;
  platform: string;
  status: "PENDING" | "ONLINE" | "OFFLINE";
  risk: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  enrollmentCode: string;
  agentTokenHash?: string | null;
  lastSeenAt: string | null;
  telemetry: string | null;
};

export function reportIsFresh(lastSeenAt: string | null | undefined, now = Date.now()) {
  if (!lastSeenAt) return false;
  const reportedAt = Date.parse(lastSeenAt);
  return Number.isFinite(reportedAt) && now - reportedAt <= ONLINE_WINDOW_MS;
}

export function reportedDeviceStatus(device: { agentTokenHash?: string | null; lastSeenAt?: string | null }, now = Date.now()) {
  if (!device.agentTokenHash) return "PENDING" as const;
  return reportIsFresh(device.lastSeenAt, now) ? "ONLINE" as const : "OFFLINE" as const;
}

export function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function irisAgentShellCommand(origin: string, enrolled: boolean) {
  const base = origin.replace(/\/$/, "");
  const script = `${base}/iris-agent-macos.sh?v=${IRIS_AGENT_SCRIPT_VERSION}`;
  const api = `${base}/api/agent/check-in`;
  const action = enrolled ? "reconnect" : "install";
  return `curl -fsSL ${JSON.stringify(script)} -o /tmp/iris-agent.sh && chmod +x /tmp/iris-agent.sh && IRIS_API_URL=${JSON.stringify(api)} /tmp/iris-agent.sh ${action}`;
}

export function deviceView(device: DeviceRecord, trustedNames: string[] = [], now = Date.now()) {
  let telemetry: AgentTelemetry | null = null;
  const parsed = parseJsonRecord(device.telemetry);
  if (Object.keys(parsed).length) telemetry = parsed as AgentTelemetry;
  const fresh = reportIsFresh(device.lastSeenAt, now);
  const enrolled = Boolean(device.agentTokenHash);
  if (telemetry) {
    telemetry.trustedApplications = trustedNames;
    telemetry.riskyApplications = (telemetry.riskyApplications || []).filter(name => !trustedNames.includes(name));
    if (!telemetry.riskyApplications.length) telemetry.securityFindings = (telemetry.securityFindings || []).filter(finding => finding !== "UNVERIFIED_APPLICATIONS_FOUND");
  }
  let healthScore: number | null = telemetry ? 100 : null;
  if (healthScore !== null) {
    if (telemetry!.firewallEnabled === false) healthScore -= 30;
    if (telemetry!.gatekeeperEnabled === false) healthScore -= 20;
    if (telemetry!.fileVaultEnabled === false) healthScore -= 25;
    if (telemetry!.sipEnabled === false) healthScore -= 25;
    if (telemetry!.automaticUpdatesEnabled === false) healthScore -= 10;
    if (telemetry!.xProtectPresent === false) healthScore -= 30;
    if (telemetry!.malwareRemovalToolPresent === false) healthScore -= 15;
    if (telemetry!.unsignedPersistenceItems?.length) healthScore -= Math.min(30, telemetry!.unsignedPersistenceItems.length * 10);
    if (telemetry!.riskyApplications?.length) healthScore -= Math.min(20, telemetry!.riskyApplications.length * 5);
    if ((telemetry!.diskUsedPercent ?? 0) >= 95) healthScore -= 30;
    else if ((telemetry!.diskUsedPercent ?? 0) >= 85) healthScore -= 15;
    if ((telemetry!.memoryUsedPercent ?? 0) >= 95) healthScore -= 20;
    else if ((telemetry!.memoryUsedPercent ?? 0) >= 85) healthScore -= 10;
    if (!fresh) healthScore -= 20;
    healthScore = Math.max(0, healthScore);
  }
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    status: reportedDeviceStatus(device, now),
    risk: device.risk,
    enrollmentCode: device.enrollmentCode,
    lastSeenAt: device.lastSeenAt,
    telemetry,
    healthScore,
    provenance: enrolled && telemetry ? "REAL" as const : "UNVERIFIED" as const,
  };
}
