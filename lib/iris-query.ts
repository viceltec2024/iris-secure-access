const WORKSPACE = /\b(dispositivos?|devices?|alertas?|alerts?|incidentes?|incidents?|agente|orquest|wallet|metamask|iris chain|telemetr|enrol|passkey|amenaza|threat|malware|hallazgos?|operaciones de seguridad|security operations|estado del sistema|system status|macos|macbook|\bmac\b|firewall|filevault|gatekeeper|xprotect|online|offline)\b/i;
const GREETING = /^(?:hola|hello|hi|buenas|hey|qué tal|que tal|buenos d[ií]as|buenas tardes)(?:\s+iris)?[!.?]*$/i;
const IDENTITY = /\b(qui[eé]n eres|who are you|qu[eé] eres|qu[eé] puedes|what can you|c[oó]mo te llamas)\b/i;
const CONVERSATION = /\b(quiero hablar|hablemos|conversemos|h[áa]blame|platiquemos|podemos hablar|talk with you|let'?s talk)\b/i;
const STOP_LINE = /^(?:(?:oye|hey|ok|okay|hola|escucha)\s+)?(?:iris\s+)?(?:stop|para|p[aá]rate|detente|silencio|c[aá]llate|callate|quiet|cancel)(?:\s+(?:iris|ya|ahora|por favor|please|de hablar|talking|speaking))?$/i;
const STOP_PHRASE = /^(?:deja de hablar|stop talking|stop speaking|no hables|shut up|iris para|iris stop|para ya|stop para|para stop)$/i;
const SOC = /\b(c[oó]mo est[aá](?:n)?(?:\s+(?:mi|el|la|los|las))?\s+(?:mac|iris|sistema|dispositivo|equipo|agente)|cu[aá]l es el estado|dime (?:el )?estado|estado de iris|estado del mac|revisa(?:r)?(?:\s+(?:el|este|mi))?\s+sistema|qu[eé] ves|qu[eé] hay en (?:el |este )?sistema|qu[eé] alertas|salud del|en l[ií]nea|fuera de l[ií]nea|mi equipo|mi computadora|este incidente|esta alerta|el incidente(?: seleccionado)?)\b/i;
const GENERIC_SYSTEM = /\b(?:el |este |mi )sistema\b/i;
const NOT_SOC_SYSTEM = /\bsistema (?:solar|nervioso|digestivo|inmun|m[eé]trico|electoral|pol[ií]tico|binario|decimal|circulatorio|respiratorio|endocrino|filos[oó]fico)\b/i;
const EXPLAINER = /\b(para qu[eé] sirve|qu[eé] es(?: un| una| el| la)?|qu[eé] significa|c[oó]mo funciona|what is|what does|how does)\b/i;
const LIVE_STATUS_OVERRIDE = /\b(mi mac|mi dispositivo|mi equipo|c[oó]mo est[aá]|est[aá] (?:el |la )?(?:firewall|filevault)|estado (?:de|del) (?:mi |el )?(?:mac|sistema|iris))\b/i;
const FOLLOW_UP = /^(?:(?:y|ok|okay|vale|bueno|bien)\s+)?(?:ahora\s+)?(?:qu[eé] hago(?: ahora)?|qu[eé] sigue|siguiente(?: paso)?|y ahora|contin[uú]a|sigue|y eso|qu[eé] recomiendas)[?.!\s]*$/i;

export function isStopRequest(question: string) {
  const normalized = question.toLocaleLowerCase().replace(/[.,!?¿¡;:]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return STOP_LINE.test(normalized) || STOP_PHRASE.test(normalized);
}

export function isAmbiguousStopPrefix(question: string) {
  const normalized = question.toLocaleLowerCase().replace(/[.,!?¿¡;:]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:(?:oye|hey|ok|okay|hola|escucha)\s+)?(?:iris\s+)?(?:para|stop)$/i.test(normalized);
}

export function isBargeInStop(question: string) {
  if (isAmbiguousStopPrefix(question)) return false;
  return isStopRequest(question);
}

export function isWorkspaceQuestion(question: string) {
  return WORKSPACE.test(question);
}

export function isConceptExplainer(question: string) {
  const text = question.trim();
  if (!EXPLAINER.test(text)) return false;
  if (LIVE_STATUS_OVERRIDE.test(text)) return false;
  return true;
}

export function isSocFollowUp(question: string) {
  return FOLLOW_UP.test(question.trim());
}

export function isSocQuestion(question: string) {
  const text = question.trim();
  if (isConceptExplainer(text)) return false;
  if (isWorkspaceQuestion(text)) return true;
  if (SOC.test(text)) return true;
  if (GENERIC_SYSTEM.test(text) && !NOT_SOC_SYSTEM.test(text)) return true;
  return false;
}

export function isGreetingQuestion(question: string) {
  return GREETING.test(question.trim());
}

export function isIdentityQuestion(question: string) {
  return IDENTITY.test(question);
}

export function isConversationStart(question: string) {
  const trimmed = question.trim();
  if (CONVERSATION.test(trimmed)) return true;
  if (!/^(?:hola|hello|hi|buenas|hey)\b/i.test(trimmed)) return false;
  return !/\b(qu[eé]|c[oó]mo|who|what|where|why|cu[aá]nto|expl[ií]ca)\b/i.test(trimmed);
}

export function extractSearchTopic(question: string) {
  let topic = question.trim().replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
  topic = topic.replace(/^(?:oye|hey|ok|okay|hola|escucha)\s+iris\s+/i, "");
  topic = topic.replace(/^iris\s+/i, "");
  topic = topic.replace(/^(?:por favor|please|dime|expl[ií]came|explica|cu[eé]ntame|cuentame|tell me|explain)\s+/i, "");
  topic = topic.replace(/^(?:para qu[eé] sirve(?:n)?)\s+/i, "");
  topic = topic.replace(/^(?:qu[eé] significa|qu[eé] son|qu[eé] es|cu[aá]les son|cu[aá]l es|qui[eé]nes son|qui[eé]n fue|qui[eé]n es|c[oó]mo funciona|c[oó]mo se|d[oó]nde est[aá]|por qu[eé]|what are|what is|who was|who are|who is|how does|how do|how to|where is|why is|why do|qu[eé])\s+/i, "");
  topic = topic.replace(/^(?:el|la|los|las|un|una|the|a|an)\s+/i, "");
  return topic.replace(/\s+/g, " ").trim().slice(0, 140);
}

function applyMath(left: number, op: string, right: number) {
  if (op === "+") return left + right;
  if (op === "-") return left - right;
  if (op === "*") return left * right;
  if (op === "/") return right === 0 ? Number.NaN : left / right;
  if (op === "%") return right === 0 ? Number.NaN : left % right;
  return Number.NaN;
}

export function tryEvaluateMath(question: string, language: "es" | "en") {
  const cleaned = question
    .toLocaleLowerCase()
    .replace(/[¿?¡!]/g, " ")
    .replace(/(cu[aá]nto es|cuanto es|calcula|calculate|what is|what's)\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s+/g, "");
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([+\-*/%])(-?\d+(?:\.\d+)?)$/);
  if (!match) return "";
  const value = applyMath(Number(match[1]), match[2], Number(match[3]));
  if (!Number.isFinite(value)) return "";
  return language === "es" ? `El resultado es ${value}.` : `The result is ${value}.`;
}
