import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { orbTint, orbWaveEnergy, orbWaveY } from "../app/dashboard/iris-orb.ts";
import { closeAudioContext, extractVoiceCommand, hasWakePhrase, irisListenPhrase, isHearingVoice, isRetryableVoiceError, isStopCommand, mapRecognitionError, pickSpeechVoice, resumeSpeechIfPaused, scoreSpeechVoice, shouldForceSpeechRetry, shouldRepeatThinkingPhrase, speechVolumeHint, splitSpeechChunks, spokenQuestionFromTranscript, voiceErrorMessage } from "../app/dashboard/iris-voice.ts";
import { fileNameForAudioType, mapMediaError, recordingMimeType, shouldFinishRecording } from "../app/dashboard/iris-record.ts";

test("accepts Oye IRIS, Hola IRIS, and IRIS alone as wake phrases", () => {
  assert.equal(extractVoiceCommand("Oye IRIS cuál es el estado", "es"), "cuál es el estado");
  assert.equal(extractVoiceCommand("Hola IRIS revisa la wallet", "es"), "revisa la wallet");
  assert.equal(hasWakePhrase("IRIS"), true);
  assert.equal(extractVoiceCommand("cuál es el estado del sistema", "es"), "cuál es el estado del sistema");
});

test("stop commands do not become questions", () => {
  assert.equal(isStopCommand("para IRIS"), true);
  assert.equal(isStopCommand("stop"), true);
  assert.equal(isStopCommand("para de hablar"), true);
  assert.equal(isStopCommand("para ya"), true);
  assert.equal(isStopCommand("para qué es el firewall"), false);
  assert.equal(extractVoiceCommand("silencio", "es"), "");
});

test("voice errors explain microphone problems in Spanish", () => {
  assert.equal(mapRecognitionError("not-allowed"), "denied");
  assert.match(voiceErrorMessage("denied", "es"), /micrófono/i);
  assert.match(voiceErrorMessage("denied", "es"), /escribir/i);
  assert.match(voiceErrorMessage("unsupported", "es"), /micrófono/i);
  assert.doesNotMatch(voiceErrorMessage("unsupported", "en"), /Chrome or Edge|remote window/i);
  assert.match(voiceErrorMessage("audio-capture", "es"), /escribe tu pregunta/i);
  assert.match(voiceErrorMessage("no-speech", "es"), /Sigo escuchando/i);
});

test("records speech without the Chrome speech API", () => {
  assert.equal(recordingMimeType(type => type === "audio/webm"), "audio/webm");
  assert.equal(fileNameForAudioType("audio/webm;codecs=opus"), "iris.webm");
  assert.equal(shouldFinishRecording({ speechMs: 800, silentMs: 950, elapsedMs: 2000 }), true);
  assert.equal(shouldFinishRecording({ speechMs: 0, silentMs: 2000, elapsedMs: 2000 }), false);
  assert.equal(mapMediaError(Object.assign(new Error("denied"), { name: "NotAllowedError" })), "denied");
  assert.equal(mapMediaError(Object.assign(new Error("missing"), { name: "NotFoundError" })), "audio-capture");
  assert.equal(mapMediaError(Object.assign(new Error("busy"), { name: "NotReadableError" })), "audio-capture");
});

test("keeps listening through empty Chrome no-speech errors", () => {
  assert.equal(isRetryableVoiceError("no-speech"), true);
  assert.equal(isRetryableVoiceError("aborted"), true);
  assert.equal(isRetryableVoiceError("denied"), false);
});

test("sends the spoken question without a wake phrase", () => {
  assert.equal(spokenQuestionFromTranscript("cuál es el estado"), "cuál es el estado");
  assert.equal(spokenQuestionFromTranscript("  hola  "), "hola");
  assert.equal(spokenQuestionFromTranscript("para IRIS"), "");
  assert.equal(isHearingVoice(0.08), true);
  assert.equal(isHearingVoice(0.01), false);
});

test("IRIS system orb grows louder when it hears or speaks", () => {
  assert.ok(orbWaveEnergy("listening", true, 0.2) > orbWaveEnergy("ready", false, 0));
  assert.ok(orbWaveEnergy("speaking", false, 0) > orbWaveEnergy("thinking", false, 0));
  assert.equal(orbTint("thinking", false).glow[2], 255);
  assert.notEqual(orbWaveY(0, 0, 0.4, 1), 0);
});

test("does not reject when an AudioContext is closed twice", async () => {
  let closes = 0;
  const audio = {
    state: "running",
    close: async () => {
      closes += 1;
      if (closes > 1) throw new Error("Cannot close a closed AudioContext.");
      await Promise.resolve();
      audio.state = "closed";
    },
  };
  await Promise.all([closeAudioContext(audio), closeAudioContext(audio)]);
  await closeAudioContext(audio);
  assert.equal(closes, 1);
  await assert.doesNotReject(() => closeAudioContext({ state: "closed", close: async () => { throw new Error("Cannot close a closed AudioContext."); } }));
});

test("resumes speech synthesis only when it is paused", () => {
  let resumes = 0;
  resumeSpeechIfPaused({ paused: false, resume: () => { resumes += 1; } });
  resumeSpeechIfPaused({ paused: true, resume: () => { resumes += 1; } });
  assert.equal(resumes, 1);
});

test("picks a Spanish voice and writes the listen phrase IRIS speaks first", () => {
  assert.equal(irisListenPhrase("es"), "Hola. Soy IRIS. Te escucho.");
  const spanish = pickSpeechVoice([
    { name: "Daniel", lang: "en-GB" },
    { name: "Paulina", lang: "es-MX", localService: true },
  ], "es");
  assert.equal(spanish?.name, "Paulina");
  assert.equal(pickSpeechVoice([{ name: "Daniel", lang: "en-GB" }], "es"), undefined);
});

test("splits spoken answers so the browser can play them out loud", () => {
  const chunks = splitSpeechChunks("Hola. ".repeat(40), 80);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 80));
  assert.ok(scoreSpeechVoice({ name: "Google Español", lang: "es-MX" }, "es") > scoreSpeechVoice({ name: "English", lang: "en-US" }, "es"));
});

test("does not keep saying Un momento after the real answer is ready", () => {
  assert.equal(shouldRepeatThinkingPhrase(true, null), true);
  assert.equal(shouldRepeatThinkingPhrase(true, "IRIS ve 1 dispositivo"), false);
  assert.equal(shouldRepeatThinkingPhrase(false, "IRIS ve 1 dispositivo"), false);
  assert.equal(shouldForceSpeechRetry(false), true);
  assert.equal(shouldForceSpeechRetry(true), false);
});

test("volume hints tell the user when voices are missing or audio is blocked", () => {
  assert.match(speechVolumeHint("es", { blocked: true, voices: 4 }), /bloqueó el audio|volumen/i);
  assert.match(speechVolumeHint("es", { voices: 0 }), /voces instaladas/i);
  assert.match(speechVolumeHint("es", { speaking: true, voices: 2 }), /está hablando|volumen/i);
  assert.match(speechVolumeHint("en", { voices: 2 }), /Tap the speaker/i);
});

test("Ask IRIS connects the microphone before saying Te escucho", () => {
  const panel = readFileSync(new URL("../app/dashboard/ask-iris-panel.tsx", import.meta.url), "utf8");
  const start = panel.slice(panel.indexOf("async function startListening()"));
  const mic = start.indexOf("openMicrophone");
  const greet = start.indexOf("irisListenPhrase");
  assert.ok(mic >= 0 && greet > mic);
  assert.match(start, /failVoiceConnect\(mapMediaError/);
  assert.match(start, /releaseAudioForMicrophone/);
  assert.doesNotMatch(start.slice(0, mic), /await speak\(/);
});
