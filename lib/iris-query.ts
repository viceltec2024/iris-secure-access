const WORKSPACE = /\b(dispositivo|device|alerta|alert|incidente|incident|agente|orquest|wallet|metamask|iris chain|telemetr|enrol|passkey|amenaza|threat|malware|operaciones de seguridad|security operations|estado del sistema|system status|macos|macbook|\bmac\b|firewall|filevault|gatekeeper|xprotect|online|offline)\b/i;
const GREETING = /^(?:hola|hello|hi|buenas|hey|qué tal|que tal|buenos d[ií]as|buenas tardes)(?:\s+iris)?[!.?]*$/i;
const IDENTITY = /\b(qui[eé]n eres|who are you|qu[eé] eres|qu[eé] puedes|what can you|c[oó]mo te llamas)\b/i;
const CONVERSATION = /\b(quiero hablar|hablemos|conversemos|h[áa]blame|platiquemos|podemos hablar|talk with you|let'?s talk)\b/i;
const SOC = /\b(c[oó]mo est[aá](?:n)?(?:\s+(?:mi|el|la|los|las))?\s+(?:mac|iris|sistema|dispositivo|equipo|agente)|cu[aá]l es el estado|estado de iris|estado del mac|qu[eé] ves|qu[eé] hay en (?:el |este )?sistema|salud del|en l[ií]nea|fuera de l[ií]nea|mi equipo|mi computadora)\b/i;

export function isWorkspaceQuestion(question: string) {
  return WORKSPACE.test(question);
}

export function isSocQuestion(question: string) {
  const text = question.trim();
  if (isWorkspaceQuestion(text)) return true;
  if (SOC.test(text)) return true;
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
