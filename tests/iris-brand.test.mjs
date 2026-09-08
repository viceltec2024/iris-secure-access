import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("IRIS brand mark is a centered emblem without a duotone ghost path", () => {
  const source = readFileSync(new URL("../app/iris-brand-mark.tsx", import.meta.url), "utf8");
  assert.match(source, /viewBox="0 0 32 32"/);
  assert.doesNotMatch(source, /opacity/);
  assert.doesNotMatch(source, /ShieldCheck/);
});

test("token deploy dialog uses the official IRIS token emblem", () => {
  const source = readFileSync(new URL("../app/dashboard/iris-chain-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /<IrisTokenMark size=\{56\} \/>/);
  assert.doesNotMatch(source, /RocketLaunch/);
});

test("voice captions can show the full spoken answer", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.iris-voice-caption\{[^}]*overflow-y:auto/);
  assert.doesNotMatch(css, /\.iris-voice-caption\{[^}]*max-width:320px/);
});

test("Ask IRIS can open in full screen", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(panel, /fullScreen \? <CornersIn/);
  assert.match(panel, /full-screen/);
  assert.match(css, /\.iris-chat\.full-screen\{/);
});

test("Ask IRIS speaks with the browser voice, not OpenAI neural TTS", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  const voice = readFileSync(new URL("../app/dashboard/iris-voice.ts", import.meta.url), "utf8");
  assert.match(panel, /speakBrowserText\(/);
  assert.match(panel, /irisListenPhrase\(/);
  assert.match(panel, /Un momento\./);
  assert.doesNotMatch(panel, /\/api\/iris-voice/);
  assert.doesNotMatch(panel, /playMpegSpeech/);
  assert.doesNotMatch(panel, /neuralVoice/);
  assert.match(voice, /window\.speechSynthesis\.speak/);
  assert.match(voice, /},\s*0\);/);
});

test("offline Macs show a reconnect command for this IRIS instance", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /Reconectar Mac/);
  assert.match(sidebar, /irisAgentShellCommand/);
  assert.match(sidebar, /IRIS_AGENT_SCRIPT_VERSION/);
});

test("security operations no longer ships training incidents", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  const i18n = readFileSync(new URL("../app/dashboard/dashboard-i18n.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sidebar, /IR-1039|IR-1042|seedIncidents|SIMULATION ANALYSIS/);
  assert.doesNotMatch(i18n, /IR-1039|Demo systems connected|Sistemas de demostración/);
  assert.match(sidebar, /buildLiveIncidents/);
});

test("sidebar and home lockups use the IRIS brand mark", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /<div className="soc-brand"><IrisBrandMark/);
  assert.doesNotMatch(sidebar, /soc-brand"><ShieldCheck/);
  assert.match(home, /<IrisBrandMark size=\{88\} \/>/);
});
