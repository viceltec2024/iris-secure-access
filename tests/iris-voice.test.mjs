import assert from "node:assert/strict";
import test from "node:test";
import { extractVoiceCommand, hasWakePhrase, isStopCommand, mapRecognitionError, voiceErrorMessage } from "../app/dashboard/iris-voice.ts";

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
  assert.match(voiceErrorMessage("unsupported", "es"), /Chrome|Edge|remota/i);
  assert.match(voiceErrorMessage("no-speech", "es"), /Pulsa el micrófono y di tu pregunta/i);
});
