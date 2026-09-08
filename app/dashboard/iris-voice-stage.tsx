import { X } from "@phosphor-icons/react";
import type { Language } from "./dashboard-i18n";

export type VoiceStageMode = "listening" | "thinking" | "speaking" | "ready";

export default function IrisVoiceStage({
  language,
  mode,
  transcript,
  answer,
  onClose,
}: {
  language: Language;
  mode: VoiceStageMode;
  transcript: string;
  answer: string;
  onClose: () => void;
}) {
  const es = language === "es";
  const title = mode === "listening" ? (es ? "Te escucho" : "Listening")
    : mode === "thinking" ? (es ? "Pensando tu respuesta" : "Thinking through your question")
    : mode === "speaking" ? (es ? "IRIS te está contestando" : "IRIS is answering you")
    : (es ? "Habla con IRIS" : "Talk with IRIS");
  const caption = mode === "listening" ? (transcript || (es ? "Pregúntame lo que quieras." : "Ask me anything."))
    : mode === "thinking" ? (transcript || (es ? "Analizando tu pregunta…" : "Analyzing your question…"))
    : (answer || transcript || (es ? "Lista para la siguiente pregunta." : "Ready for the next question."));

  return (
    <section className={`iris-voice-stage ${mode}`} aria-live="polite" aria-label={title}>
      <button type="button" className="iris-voice-close" onClick={onClose} aria-label={es ? "Cerrar voz" : "Close voice"}><X /></button>
      <div className="iris-voice-rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="iris-voice-face">
        <img src="/assets/iris-avatar.webp" alt="" width="132" height="132" />
        <span className="iris-voice-mouth" />
      </div>
      <div className="iris-voice-wave" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ animationDelay: `${index * 80}ms` }} />)}
      </div>
      <p className="iris-voice-status">{title}</p>
      <p className="iris-voice-caption">{caption}</p>
    </section>
  );
}
