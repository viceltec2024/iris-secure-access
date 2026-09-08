import { localIrisAnswer, type IrisAnalystInput } from "./iris-local-analyst.ts";
import { isGreetingQuestion, isIdentityQuestion, isWorkspaceQuestion, tryEvaluateMath } from "./iris-query.ts";
import { irisWorldAnswer } from "./iris-world-knowledge.ts";

function firstName(value: string) {
  return value.split(/[\s@]/)[0] || "operador";
}

function identityAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Soy IRIS. Puedo contestarte casi cualquier cosa: ciencia, historia, matemáticas, tecnología, ideas, código o lo que estés pensando. También soy el copiloto de este espacio: veo dispositivos, agentes, alertas y la wallet cuando me lo pides. ${name}, pregúntame con tus palabras.`
    : `I'm IRIS. I can answer almost anything: science, history, math, technology, ideas, code, or whatever you are thinking about. I am also the copilot of this workspace: I can see devices, agents, alerts, and the wallet when you ask. ${name}, ask me in your own words.`;
}

function generalFallback(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `${name}, quiero contestarte bien y no inventar. Sobre “${input.question.trim()}”: dime un poco más el ángulo que te importa — definición, cómo funciona, un ejemplo o qué harías tú — y te lo desgloso con claridad.`
    : `${name}, I want to answer you well and not invent. About “${input.question.trim()}”: tell me the angle you care about — a definition, how it works, an example, or what you should do — and I will break it down clearly.`;
}

export async function irisMindAnswer(input: IrisAnalystInput) {
  if (isIdentityQuestion(input.question)) return { answer: identityAnswer(input), source: "local" };
  if (isGreetingQuestion(input.question) || isWorkspaceQuestion(input.question)) {
    return { answer: localIrisAnswer(input), source: "local" };
  }
  const math = tryEvaluateMath(input.question, input.language);
  if (math) return { answer: math, source: "local" };
  const world = await irisWorldAnswer(input.question, input.language, firstName(input.userName)).catch(() => "");
  if (world) return { answer: world, source: "world" };
  if (/(estado|status|sistema|agentes|wallet|dispositivo)/i.test(input.question)) {
    return { answer: localIrisAnswer(input), source: "local" };
  }
  return { answer: generalFallback(input), source: "local" };
}
