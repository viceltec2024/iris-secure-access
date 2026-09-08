import assert from "node:assert/strict";
import test from "node:test";
import { extractVoiceCommand, hasWakePhrase, isHearingVoice, isRetryableVoiceError, isStopCommand, mapRecognitionError, spokenQuestionFromTranscript, voiceErrorMessage } from "../app/dashboard/iris-voice.ts";
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
