import assert from "node:assert/strict";
import test from "node:test";
import { orbTint, orbWaveEnergy, orbWaveY } from "../app/dashboard/iris-orb.ts";
import { closeAudioContext, extractVoiceCommand, hasWakePhrase, irisListenPhrase, isHearingVoice, isRetryableVoiceError, isStopCommand, mapRecognitionError, pickSpeechVoice, resumeSpeechIfPaused, scoreSpeechVoice, splitSpeechChunks, spokenQuestionFromTranscript, voiceErrorMessage } from "../app/dashboard/iris-voice.ts";
import { fileNameForAudioType, mapMediaError, recordingMimeType, shouldFinishRecording } from "../app/dashboard/iris-record.ts";

test("accepts Oye IRIS, Hola IRIS, and IRIS alone as wake phrases", () => {
  assert.equal(extractVoiceCommand("Oye IRIS cuál es el estado", "es"), "cuál es el estado");
  assert.equal(extractVoiceCommand("Hola IRIS revisa la wallet", "es"), "revisa la wallet");
  assert.equal(hasWakePhrase("IRIS"), true);
  assert.equal(extractVoiceCommand("cuál es el estado del sistema", "es"), "cuál es el estado del sistema");
});

test("stop commands do not become questions", () => {
  assert.equal(isStopCommand("para IRIS"), true);
  assert.equal(extractVoiceCommand("silencio", "es"), "");
});

test("voice errors explain microphone problems in Spanish", () => {
  assert.equal(mapRecognitionError("not-allowed"), "denied");
  assert.match(voiceErrorMessage("denied", "es"), /micrófono/i);
  assert.match(voiceErrorMessage("unsupported", "es"), /micrófono/i);
  assert.doesNotMatch(voiceErrorMessage("unsupported", "en"), /Chrome or Edge|remote window/i);
  assert.match(voiceErrorMessage("no-speech", "es"), /Sigo escuchando/i);
});

test("records speech without the Chrome speech API", () => {
  assert.equal(recordingMimeType(type => type === "audio/webm"), "audio/webm");
  assert.equal(fileNameForAudioType("audio/webm;codecs=opus"), "iris.webm");
  assert.equal(shouldFinishRecording({ speechMs: 800, silentMs: 950, elapsedMs: 2000 }), true);
  assert.equal(shouldFinishRecording({ speechMs: 0, silentMs: 2000, elapsedMs: 2000 }), false);
  assert.equal(mapMediaError(Object.assign(new Error("denied"), { name: "NotAllowedError" })), "denied");
  assert.equal(mapMediaError(Object.assign(new Error("missing"), { name: "NotFoundError" })), "audio-capture");
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
