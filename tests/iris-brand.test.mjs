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

test("Ask IRIS panel is a large assistant, not a 390px widget", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /width:min\(820px,46vw,calc\(100vw - 32px\)\)/);
  assert.match(css, /height:min\(calc\(100vh - 24px\),960px\)/);
  assert.match(css, /\.iris-chat-messages article p\{margin:0;font-size:16px/);
  assert.doesNotMatch(css, /width:min\(390px,calc\(100vw - 32px\)\)/);
});

test("Ask IRIS keeps the written conversation visible while listening", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(panel, /className="iris-chat-messages"/);
  assert.match(panel, /sendQueueRef/);
  assert.match(panel, /controller\.abort\(\), 15000\)/);
  assert.doesNotMatch(panel, /disabled=\{\!input\.trim\(\) \|\| loading\}/);
  assert.match(css, /\.iris-chat\.voice-open\{grid-template-rows:auto auto 1fr auto auto\}/);
});

test("Ask IRIS voice orb is large enough to read, not a 120px icon", () => {
  const stage = readFileSync(new URL("../app/dashboard/iris-voice-stage.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(stage, /size=\{expanded \? 520 : 360\}/);
  assert.doesNotMatch(stage, /size=\{expanded \? 280 : 120\}/);
  assert.doesNotMatch(css, /\.iris-chat\.voice-open \.iris-voice-stage\{min-height:132px/);
});

test("Ask IRIS speaks with the browser voice, not OpenAI neural TTS", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  const voice = readFileSync(new URL("../app/dashboard/iris-voice.ts", import.meta.url), "utf8");
  assert.match(panel, /speakBrowserText\(/);
  assert.match(panel, /irisListenPhrase\(/);
  assert.match(panel, /sendQueueRef/);
  assert.doesNotMatch(panel, /Un momento\./);
  assert.doesNotMatch(panel, /\/api\/iris-voice/);
  assert.doesNotMatch(panel, /playMpegSpeech/);
  assert.doesNotMatch(panel, /neuralVoice/);
  assert.match(voice, /synth\.speak\(/);
  assert.match(voice, /synth\.getVoices\(\)/);
  assert.match(voice, /SPEECH_CANCEL_GAP_MS/);
  assert.match(voice, /shouldForceSpeechRetry/);
  assert.match(panel, /speechSeqRef/);
  assert.doesNotMatch(panel, /queuedSpeechRef\.current = text/);
  assert.match(panel, /speechVolumeHint\(/);
  assert.match(panel, /onPointerDown=\{event => connectVoice\(event\)\}/);
  assert.match(panel, /onSpeakerClick/);
  assert.match(panel, /Conectar la voz de IRIS/);
  assert.match(panel, /honorStop/);
  assert.match(panel, /isStopCommand\(clean\)/);
  assert.match(panel, /startBargeIn/);
});

test("offline Macs show a reconnect command for this IRIS instance", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /Reconectar Mac/);
  assert.match(sidebar, /ops-reconnect/);
  assert.match(sidebar, /irisAgentShellCommand/);
  assert.match(sidebar, /irisReconnectOrigin/);
  assert.match(sidebar, /liveSocMetrics/);
  assert.match(sidebar, /stale-telemetry/);
  assert.match(sidebar, /IRIS_AGENT_SCRIPT_VERSION/);
  assert.match(page, /initialDevices=\{bootstrap\.devices\}/);
  assert.match(page, /dashboardDeviceBootstrap/);
  assert.doesNotMatch(sidebar, /irisAgentShellCommand\(pageOrigin/);
});

test("dashboard language and reconnect URL wait until after hydration", () => {
  const sidebar = readFileSync(new URL("../app/dashboard/security-operations.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /useState<Language>\("es"\)/);
  assert.match(sidebar, /setPageOrigin\(window\.location\.origin\)/);
  assert.doesNotMatch(sidebar, /typeof window === "undefined" \? "en"/);
  assert.doesNotMatch(sidebar, /typeof window === "undefined" \? "" : window\.location\.origin/);
});

test("admin timestamps do not use the browser locale during SSR", () => {
  const page = readFileSync(new URL("../app/admin/users/page.tsx", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../app/admin/users/user-directory.tsx", import.meta.url), "utf8");
  assert.match(page, /formatUtcClock\(event\.createdAt\)/);
  assert.match(directory, /formatUtcClock\(user\.lastSeenAt\)/);
  assert.doesNotMatch(page, /toLocaleString/);
  assert.doesNotMatch(directory, /toLocaleString/);
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

test("local dashboard access signs in on this machine, not ChatGPT", () => {
  const auth = readFileSync(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8");
  const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const signIn = readFileSync(new URL("../app/dev/sign-in/route.ts", import.meta.url), "utf8");
  const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
  const localDev = readFileSync(new URL("../scripts/dev-local.sh", import.meta.url), "utf8");
  assert.match(auth, /devDefaultEmail\(\)/);
  assert.match(auth, /\/dev\/sign-in\?return_to=/);
  assert.match(signIn, /text\/html; charset=utf-8/);
  assert.match(vite, /allowedHosts:\s*true/);
  assert.match(vite, /host:\s*true/);
  assert.doesNotMatch(vite, /host:\s*"::"/);
  assert.match(vite, /isCodexSandbox/);
  assert.match(vite, /IRIS_PUBLIC_ORIGIN/);
  assert.match(localDev, /CODEX_SANDBOX/);
  assert.match(agents, /npm run dev:local/);
});

test("dashboard fonts come from Inter, not vinext Geist filesystem URLs", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /next\/font|GeistSans|GeistMono|geist/);
  assert.match(css, /fonts\.googleapis\.com\/css2\?family=Inter/);
});
