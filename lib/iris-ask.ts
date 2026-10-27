import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings, devices, securityAlerts } from "../db/schema";
import { parseWalletSessionValue } from "./iris-chain.ts";
import { parseJsonRecord, reportedDeviceStatus } from "./iris-device-view.ts";
import { liveWorkers } from "./iris-live-soc.ts";
import { IRIS_KNOWLEDGE_SETTING, parseKnowledgeStore, rememberKnowledge, seededKnowledgeStore, serializeLearnedKnowledge } from "./iris-knowledge.ts";
import { activeLessons, emptyMemoryStore, parseMemoryStore, searchMemory, type MemoryRecord } from "./iris-memory.ts";
import { irisMindAnswer } from "./iris-mind.ts";
import { withSettingCas } from "./iris-settings-cas.ts";
import { isMuseConfigured } from "./iris-muse.ts";
import { briefingFromBoard, extractTicker, fetchLiveTape, fetchMarketChart, isMarketQuestion, marketAnswer } from "./iris-market.ts";
import { loadOrgDeskValue } from "./iris-org-store.ts";
import { parsePurchaseDesk } from "./iris-purchases.ts";
import { requireOrgContext } from "./iris-tenant.ts";
import type { IrisIncidentContext } from "./iris-local-analyst.ts";

export type IrisAskMessage = { role: "user" | "assistant"; content: string };
export type IrisAskUser = { email: string; role: string; displayName: string };

function parseAskAttachments(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ name: string; mime: string; dataUrl: string }>;
  return value
    .filter(item => item && typeof item === "object")
    .map(item => item as Record<string, unknown>)
    .filter(item => typeof item.dataUrl === "string" && typeof item.mime === "string")
    .filter(item => String(item.mime).startsWith("image/") && String(item.dataUrl).length <= 220_000)
    .slice(0, 2)
    .map(item => ({
      name: String(item.name || "evidence").slice(0, 80),
      mime: String(item.mime).slice(0, 80),
      dataUrl: String(item.dataUrl),
    }));
}

export function parseAskIncident(value: unknown): IrisIncidentContext | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) return null;
  const attachments = parseAskAttachments(item.attachments);
  return {
    id: item.id.slice(0, 80),
    title: typeof item.title === "string" ? item.title.slice(0, 200) : "",
    subject: typeof item.subject === "string" ? item.subject.slice(0, 200) : "",
    severity: typeof item.severity === "string" ? item.severity.slice(0, 40) : "",
    status: typeof item.status === "string" ? item.status.slice(0, 40) : "",
    source: typeof item.source === "string" ? item.source.slice(0, 80) : "",
    evidence: Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === "string").slice(0, 8).map(entry => entry.slice(0, 240)) : [],
    recommendation: typeof item.recommendation === "string" ? item.recommendation.slice(0, 400) : "",
    attachments: attachments.length ? attachments : undefined,
  };
}

function lessonSnippets(records: MemoryRecord[]) {
  return records.slice(0, 5).map(item => ({
    id: item.id,
    title: item.title,
    body: item.body.slice(0, 280),
    promotion: item.promotion,
  }));
}

export async function resolveIrisAsk(input: {
  user: IrisAskUser;
  messages: IrisAskMessage[];
  language: "es" | "en";
  section: string;
  incident: IrisIncidentContext | null;
  origin: string;
}) {
  const db = getDb();
  const deviceRows = input.user.role === "ADMIN"
    ? await db.select().from(devices).orderBy(desc(devices.createdAt)).limit(25)
    : await db.select().from(devices).where(eq(devices.ownerEmail, input.user.email)).orderBy(desc(devices.createdAt)).limit(25);
  const alertRows = deviceRows.length
    ? await db.select().from(securityAlerts).where(inArray(securityAlerts.deviceId, deviceRows.map(device => device.id))).orderBy(desc(securityAlerts.lastSeenAt)).limit(50)
    : [];
  const [walletRow] = await db.select().from(appSettings).where(eq(appSettings.key, `iris_local_wallet_session:${input.user.email}`)).limit(1);
  const [deskRow] = await db.select().from(appSettings).where(eq(appSettings.key, `iris_purchase_desk:${input.user.email}`)).limit(1);
  const wallet = parseWalletSessionValue(walletRow?.value || "");
  const pendingPurchases = parsePurchaseDesk(deskRow?.value || "").proposals.filter(item => item.status === "awaiting_approval").length;
  let memoryStore = emptyMemoryStore();
  try {
    const ctx = await requireOrgContext(input.user.email);
    const loaded = await loadOrgDeskValue({ kind: "memory", organizationId: ctx.organization.id, email: input.user.email });
    memoryStore = loaded.value ? parseMemoryStore(loaded.value) : emptyMemoryStore();
  } catch {
    memoryStore = emptyMemoryStore();
  }
  const mappedDevices = deviceRows.map(device => ({
    id: device.id,
    name: device.name,
    platform: device.platform,
    status: reportedDeviceStatus(device),
    risk: device.risk,
    lastSeenAt: device.lastSeenAt,
    telemetry: parseJsonRecord(device.telemetry),
  }));
  const agents = liveWorkers({
    devices: mappedDevices,
    walletConnected: Boolean(wallet),
    walletAddress: wallet?.address,
    marketLive: true,
    auditCount: 1,
    pendingPurchases,
    museReady: isMuseConfigured(),
    language: input.language,
  });
  const question = [...input.messages].reverse().find(message => message.role === "user")?.content || "";
  const approvedLessons = activeLessons(memoryStore);
  const relatedMemory = searchMemory(memoryStore, question, 4);
  let knowledge = seededKnowledgeStore();
  try {
    const [knowledgeRow] = await db.select().from(appSettings).where(eq(appSettings.key, IRIS_KNOWLEDGE_SETTING)).limit(1);
    knowledge = seededKnowledgeStore(parseKnowledgeStore(knowledgeRow?.value || ""));
  } catch {
    knowledge = seededKnowledgeStore();
  }
  const analystInput = {
    language: input.language,
    question,
    userName: input.user.displayName || input.user.email,
    origin: input.origin,
    section: input.section,
    devices: mappedDevices,
    alerts: alertRows.map(alert => ({ deviceId: alert.deviceId, code: alert.code, severity: alert.severity, status: alert.status, evidence: parseJsonRecord(alert.evidence), lastSeenAt: alert.lastSeenAt })),
    agents: agents.map(agent => ({ id: agent.id, role: agent.role, status: agent.status, task: agent.task })),
    wallet: { connected: Boolean(wallet), address: wallet?.address || "" },
    incident: input.incident,
    lessons: lessonSnippets(approvedLessons),
    memoryHits: lessonSnippets(relatedMemory),
    knowledge,
  };

  if (isMarketQuestion(question)) {
    try {
      const ticker = extractTicker(question);
      const [tape, chart] = await Promise.all([
        fetchLiveTape(),
        ticker ? fetchMarketChart(ticker, "1d").catch(() => null) : Promise.resolve(null),
      ]);
      const board = {
        updatedAt: tape.updatedAt,
        live: tape.live,
        quotes: tape.quotes,
        ideas: [],
        briefing: briefingFromBoard(tape.quotes, []),
      };
      return { answer: marketAnswer(question, input.language, board, chart), source: "live-market" as const, model: "iris-jar-live", ticker: ticker || "" };
    } catch {
      const tape = await fetchLiveTape().catch(() => null);
      if (tape?.quotes.length) {
        const lead = tape.quotes.slice(0, 4).map(item => `${item.symbol} ${item.price} (${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%)`).join(" · ");
        return {
          answer: input.language === "es"
            ? `IRIS en vivo. Cinta ahora: ${lead}. Si quieres una lectura de un ticker, dímelo.`
            : `IRIS is live. Tape now: ${lead}. Ask for a ticker if you want a reading.`,
          source: "live-market" as const,
          model: "iris-jar-live",
          ticker: "",
        };
      }
    }
  }

  const mind = await irisMindAnswer(analystInput);
  if (mind.knowledge && serializeLearnedKnowledge(mind.knowledge) !== serializeLearnedKnowledge(knowledge)) {
    await withSettingCas({
      key: IRIS_KNOWLEDGE_SETTING,
      actorEmail: input.user.email,
      mutate: (current) => {
        let next = seededKnowledgeStore(parseKnowledgeStore(current));
        for (const fact of mind.knowledge?.facts.filter(item => item.origin === "learned") || []) {
          next = rememberKnowledge(next, fact);
        }
        return { value: serializeLearnedKnowledge(next), result: true };
      },
    }).catch(() => false);
  }
  return {
    answer: mind.answer,
    source: mind.source,
    model: mind.source === "world" ? "iris-mind" : "iris-local-analyst",
    ticker: "",
    context: analystInput,
  };
}
