import { localIrisAnswer, explainIrisControl, type IrisAnalystInput } from "./iris-local-analyst.ts";
import { isConceptExplainer, isConversationStart, isGreetingQuestion, isIdentityQuestion, isPhoneUseQuestion, isSocFollowUp, isSocQuestion, isStopRequest, tryEvaluateMath } from "./iris-query.ts";
import { irisWorldAnswer } from "./iris-world-knowledge.ts";

function firstName(value: string) {
  return value.split(/[\s@]/)[0] || "operador";
}

function identityAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Soy IRIS. Háblame como a una persona: te contesto en claro, del Mac, de una alerta, de una idea o de lo que se te ocurra. ${name}, pregúntame con tus palabras.`
    : `I'm IRIS. Talk to me like a person: I'll answer plainly about the Mac, an alert, an idea, or whatever you have in mind. ${name}, ask me in your own words.`;
}

function conversationAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Hola, ${name}. Aquí estoy y te escucho. Pregúntame lo que quieras: cómo está tu Mac, una cuenta, una explicación, lo que sea. Te contesto directo.`
    : `Hi, ${name}. I'm here and listening. Ask me anything: how your Mac is doing, a calculation, an explanation, whatever you need. I'll answer directly.`;
}

function generalFallback(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  const topic = input.question.trim();
  return es
    ? `${name}, sobre “${topic}” no me llegó un dato limpio ahora. Si es de tu Mac, el firewall o IRIS, te lo miro con lo que el agente reportó. Si es otra cosa, dímelo en una frase y lo busco otra vez.`
    : `${name}, I didn't get a clean answer for “${topic}” just now. If it's about your Mac, the firewall, or IRIS, I'll use what the agent reported. Otherwise say it in one sentence and I'll look again.`;
}

export async function irisMindAnswer(input: IrisAnalystInput) {
  if (isStopRequest(input.question)) {
    return {
      answer: input.language === "es" ? "Paré. Dime cuando quieras seguir." : "Stopped. Tell me when you want to continue.",
      source: "local" as const,
    };
  }
  if (isPhoneUseQuestion(input.question)) {
    const name = firstName(input.userName);
    return {
      answer: input.language === "es"
        ? `${name}, IRIS ya corre en el teléfono. En Safari abre el dashboard, toca Compartir y elige Añadir a pantalla de inicio. Luego entra como una app: abajo tienes Operaciones, Débito, Ask IRIS y Dispositivos. Habla o escribe. Si dices cancela o para, me detengo. Débito nunca cobra sola: tú apruebas y MetaMask o Robinhood terminan el pago.`
        : `${name}, IRIS already runs on your phone. In Safari open the dashboard, tap Share, then Add to Home Screen. After that it opens like an app: Operations, Debit, Ask IRIS, and Devices are at the bottom. Speak or type. Say cancel or stop and I halt. Debit never charges alone: you approve, and MetaMask or Robinhood finish the payment.`,
      source: "local",
    };
  }
  if (isIdentityQuestion(input.question)) return { answer: identityAnswer(input), source: "local" };
  if (isGreetingQuestion(input.question) || isConversationStart(input.question)) {
    return { answer: conversationAnswer(input), source: "local" };
  }
  if (isSocQuestion(input.question) || isSocFollowUp(input.question)) return { answer: localIrisAnswer(input), source: "local" };
  const math = tryEvaluateMath(input.question, input.language);
  if (math) return { answer: math, source: "local" };
  if (isConceptExplainer(input.question)) {
    const explained = explainIrisControl(input.question, input.language, input.userName);
    if (explained) return { answer: explained, source: "local" };
  }
  const world = await irisWorldAnswer(input.question, input.language, firstName(input.userName)).catch(() => "");
  if (world) return { answer: world, source: "world" };
  if (!isConceptExplainer(input.question) && !/\bsistema (?:solar|nervioso|digestivo|inmun|m[eé]trico|electoral|pol[ií]tico)\b/i.test(input.question) && /(estado|status|sistema|agentes|wallet|dispositivo|mac|firewall)/i.test(input.question)) {
    return { answer: localIrisAnswer(input), source: "local" };
  }
  return { answer: generalFallback(input), source: "local" };
}
