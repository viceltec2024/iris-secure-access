import { localIrisAnswer, type IrisAnalystInput } from "./iris-local-analyst.ts";
import { isConversationStart, isGreetingQuestion, isIdentityQuestion, isSocQuestion, tryEvaluateMath } from "./iris-query.ts";
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
  if (isIdentityQuestion(input.question)) return { answer: identityAnswer(input), source: "local" };
  if (isGreetingQuestion(input.question) || isConversationStart(input.question)) {
    return { answer: conversationAnswer(input), source: "local" };
  }
  if (isSocQuestion(input.question)) return { answer: localIrisAnswer(input), source: "local" };
  const math = tryEvaluateMath(input.question, input.language);
  if (math) return { answer: math, source: "local" };
  const world = await irisWorldAnswer(input.question, input.language, firstName(input.userName)).catch(() => "");
  if (world) return { answer: world, source: "world" };
  if (/(estado|status|sistema|agentes|wallet|dispositivo|mac|firewall)/i.test(input.question)) {
    return { answer: localIrisAnswer(input), source: "local" };
  }
  return { answer: generalFallback(input), source: "local" };
}
