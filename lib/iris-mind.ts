import { creatorAskReply, extractSpecialty, isCreatorRequest } from "./iris-creator.ts";
import { seededKnowledgeStore } from "./iris-knowledge.ts";
import { localIrisAnswer, explainIrisControl, type IrisAnalystInput } from "./iris-local-analyst.ts";
import { isConceptExplainer, isConversationStart, isGreetingQuestion, isIdentityQuestion, isOwnIntelligenceQuestion, isSocFollowUp, isSocQuestion, isStopRequest, tryEvaluateMath } from "./iris-query.ts";
import { resolveIrisKnowledge } from "./iris-world-knowledge.ts";

function firstName(value: string) {
  return value.split(/[\s@]/)[0] || "operador";
}

function identityAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Soy IRIS. Tengo inteligencia propia: el Mac y el SOC los leo del agente, y el conocimiento del mundo vive dentro de mí (Wikipedia integrada). No espero a ChatGPT para pensar. ${name}, pregúntame con tus palabras.`
    : `I'm IRIS. I have my own intelligence: Mac and SOC come from the agent, and world knowledge lives inside me (Wikipedia built in). I don't wait on ChatGPT to think. ${name}, ask me in your own words.`;
}

function ownIntelligenceAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Sí, ${name}. Wikipedia está dentro de IRIS: la mente local guarda el conocimiento, te responde con mi voz y cita la fuente. El SOC sigue siendo mío, con lo que reportó el agente. Pregúntame un tema y lo saco de esa inteligencia.`
    : `Yes, ${name}. Wikipedia lives inside IRIS: the local mind keeps the knowledge, answers in my voice, and cites the source. SOC stays mine, from what the agent reported. Ask a topic and I'll pull it from that intelligence.`;
}

function conversationAnswer(input: IrisAnalystInput) {
  const es = input.language === "es";
  const name = firstName(input.userName);
  return es
    ? `Hola, ${name}. Aquí estoy y te escucho. Pregúntame lo que quieras: cómo está tu Mac, una cuenta, una explicación, lo que sea. Te contesto con mi mente.`
    : `Hi, ${name}. I'm here and listening. Ask me anything: how your Mac is doing, a calculation, an explanation, whatever you need. I'll answer with my own mind.`;
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
  if (isIdentityQuestion(input.question)) return { answer: identityAnswer(input), source: "local" };
  if (isOwnIntelligenceQuestion(input.question)) return { answer: ownIntelligenceAnswer(input), source: "local" };
  if (isGreetingQuestion(input.question) || isConversationStart(input.question)) {
    return { answer: conversationAnswer(input), source: "local" };
  }
  if (isCreatorRequest(input.question)) {
    return {
      answer: creatorAskReply(input.language, input.userName, extractSpecialty(input.question, input.language)),
      source: "local" as const,
    };
  }
  if (isSocQuestion(input.question) || isSocFollowUp(input.question)) return { answer: localIrisAnswer(input), source: "local" };
  const math = tryEvaluateMath(input.question, input.language);
  if (math) return { answer: math, source: "local" };
  if (isConceptExplainer(input.question)) {
    const explained = explainIrisControl(input.question, input.language, input.userName);
    if (explained) return { answer: explained, source: "local" };
  }
  const knowledge = seededKnowledgeStore(input.knowledge);
  const world = await resolveIrisKnowledge({
    question: input.question,
    language: input.language,
    name: firstName(input.userName),
    store: knowledge,
  }).catch(() => ({ answer: "", store: knowledge, origin: null as const }));
  if (world.answer) return { answer: world.answer, source: "world", knowledge: world.store };
  if (!isConceptExplainer(input.question) && !/\bsistema (?:solar|nervioso|digestivo|inmun|m[eé]trico|electoral|pol[ií]tico)\b/i.test(input.question) && /(estado|status|sistema|agentes|wallet|dispositivo|mac|firewall)/i.test(input.question)) {
    return { answer: localIrisAnswer(input), source: "local" };
  }
  return { answer: generalFallback(input), source: "local" };
}
