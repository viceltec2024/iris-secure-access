import type { Language } from "./dashboard-i18n";
import IrisSystemOrb from "./iris-system-orb";

export type VoiceStageMode = "listening" | "thinking" | "speaking" | "ready";

export default function IrisVoiceStage({
  language,
  mode,
  transcript,
  answer,
  hearing = false,
  level = 0,
  showHear = false,
  onHear,
  expanded = false,
}: {
  language: Language;
  mode: VoiceStageMode;
  transcript: string;
  answer: string;
  hearing?: boolean;
  level?: number;
  showHear?: boolean;
  onHear?: () => void;
  expanded?: boolean;
}) {
  const es = language === "es";
  const title = mode === "listening" ? (hearing ? (es ? "Te oigo" : "I hear you") : (es ? "Te escucho" : "Listening"))
    : mode === "thinking" ? (es ? "Pensando tu respuesta" : "Thinking through your question")
    : mode === "speaking" ? (es ? "IRIS te está contestando" : "IRIS is answering you")
    : (es ? "Habla con IRIS" : "Talk with IRIS");
  const caption = mode === "listening" ? (transcript || (hearing ? (es ? "Sigue, te estoy oyendo." : "Keep going, I can hear you.") : (es ? "Habla ahora. Me quedo escuchando." : "Speak now. I am staying on the microphone.")))
    : mode === "thinking" ? (transcript || (es ? "Analizando tu pregunta…" : "Analyzing your question…"))
    : (answer || transcript || (es ? "Lista para la siguiente pregunta." : "Ready for the next question."));

  return (
    <section className={`iris-voice-stage ${mode}${hearing ? " hearing" : ""}`} aria-live="polite" aria-label={title}>
      <IrisSystemOrb mode={mode} hearing={hearing} level={level} size={expanded ? 360 : 236} />
      <p className="iris-voice-status">{title}</p>
      <p className="iris-voice-caption">{caption}</p>
      {showHear && onHear ? <button type="button" className="iris-voice-hear" onClick={onHear}>{es ? "Oír a IRIS" : "Hear IRIS"}</button> : null}
    </section>
  );
}
