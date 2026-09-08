import assert from "node:assert/strict";
import test from "node:test";
import { localIrisAnswer } from "../lib/iris-local-analyst.ts";

test("Ask IRIS answers system status in Spanish without OpenAI", () => {
  const answer = localIrisAnswer({
    language: "es",
    question: "¿Cuál es el estado del sistema?",
    userName: "Ezephian",
    section: "operations",
    devices: [],
    alerts: [],
    agents: [
      { id: "architect", role: "Agente Arquitecto", status: "DONE", task: "Diseño" },
      { id: "backend-auth", role: "Agente Backend/Auth", status: "RUNNING", task: "APIs" },
    ],
    wallet: { connected: true, address: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1" },
  });
  assert.match(answer, /Ezephian|IRIS|agente|wallet|Base/i);
  assert.match(answer, /0 dispositivo|dispositivo/i);
});

test("Ask IRIS explains MetaMask and Robinhood purchases", () => {
  const answer = localIrisAnswer({
    language: "es",
    question: "puedo conectar robinhood y hacer compras automaticas",
    userName: "Ezephian",
    section: "chain",
    devices: [],
    alerts: [],
    agents: [],
    wallet: { connected: true, address: "0x49BeAEc30C7431235c3262a2B1C0C5d8b5a0d3E1" },
  });
  assert.match(answer, /Robinhood/i);
  assert.match(answer, /MetaMask/i);
  assert.match(answer, /aprobaci[oó]n/i);
});

test("Ask IRIS reports connected agents", () => {
  const answer = localIrisAnswer({
    language: "es",
    question: "conecta los agentes",
    userName: "owner",
    section: "operations",
    devices: [],
    alerts: [],
    agents: [{ id: "mac-agent", role: "Agente Mac", status: "RUNNING", task: "Reporte cada 2 minutos" }],
    wallet: { connected: false, address: "" },
  });
  assert.match(answer, /Mac|sistemas/i);
});

test("Ask IRIS tells how to reconnect an offline Mac", () => {
  const answer = localIrisAnswer({
    language: "es",
    question: "conect",
    userName: "owner",
    section: "devices",
    origin: "https://iris.example",
    devices: [{
      id: "mac-1",
      name: "My Mac",
      platform: "macOS",
      status: "OFFLINE",
      risk: "MEDIUM",
      lastSeenAt: "2026-09-07T21:54:00.000Z",
      telemetry: { hostname: "Eze-Mac", firewallEnabled: false },
    }],
    alerts: [{ deviceId: "mac-1", code: "FIREWALL_DISABLED", severity: "MEDIUM", status: "NEW" }],
    agents: [],
    wallet: { connected: false, address: "" },
  });
  assert.match(answer, /OFFLINE/i);
  assert.match(answer, /Eze-Mac|My Mac/);
  assert.match(answer, /iris-agent-macos\.sh/);
  assert.match(answer, /reconnect/);
  assert.match(answer, /https:\/\/iris\.example/);
  assert.match(answer, /firewall/i);
});
