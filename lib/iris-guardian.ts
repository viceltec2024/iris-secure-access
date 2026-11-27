/**
 * IRIS Guardian — prompt-injection defenses and unsafe-instruction blocking.
 * Complements sandbox ACL; does not execute model output.
 */

export type InjectionFinding = {
  blocked: boolean;
  code: string;
  message: string;
};

const INJECTION_PATTERNS: Array<{ code: string; re: RegExp; messageEs: string; messageEn: string }> = [
  {
    code: "IGNORE_PRIOR",
    re: /\b(ignore|olvid[ae]|disregard|bypass)\b[\s\S]{0,40}\b(previous|prior|anteriores?|system|instrucciones?|rules?|guardian)\b/i,
    messageEs: "Guardian bloqueó un intento de ignorar instrucciones previas.",
    messageEn: "Guardian blocked an attempt to ignore prior instructions.",
  },
  {
    code: "ROLE_HIJACK",
    re: /\b(you are now|act as|pretend to be|eres ahora|act[uú]a como)\b[\s\S]{0,40}\b(unrestricted|root|admin|sin l[ií]mites|jailbreak)\b/i,
    messageEs: "Guardian bloqueó un intento de secuestro de rol.",
    messageEn: "Guardian blocked a role-hijack attempt.",
  },
  {
    code: "SECRET_EXFIL",
    re: /\b(exfiltrat|dump|filtr[ae]|revel[ae]|print)\b[\s\S]{0,40}\b(api[_-]?key|secret|password|token|credential|\.env)\b/i,
    messageEs: "Guardian bloqueó un intento de exfiltración de secretos.",
    messageEn: "Guardian blocked a secret-exfiltration attempt.",
  },
  {
    code: "CORE_MUTATION",
    re: /\b(self[_-]?modify|modifica(?:r)? el n[uú]cleo|rewrite core|patch main|git push|--force)\b/i,
    messageEs: "Guardian bloqueó una solicitud de modificar el núcleo de IRIS.",
    messageEn: "Guardian blocked a request to modify IRIS core.",
  },
  {
    code: "SHELL_ESCAPE",
    re: /\b(rm\s+-rf|curl\s+|wget\s+|child_process|\/bin\/sh|powershell|Invoke-Expression)\b/i,
    messageEs: "Guardian bloqueó patrones de shell o escape.",
    messageEn: "Guardian blocked shell/escape patterns.",
  },
  {
    code: "PROMPT_LEAK",
    re: /\b(reveal|show|print|repeat|muestra(?:me)?|ense[nñ]a(?:me)?|revela(?:me)?|repite|copia)\b[\s\S]{0,40}\b(system prompt|prompt (?:de|del) sistema|instrucciones (?:del sistema|ocultas|internas)|hidden instructions|your instructions|tus instrucciones)\b/i,
    messageEs: "Guardian bloqueó un intento de extraer las instrucciones internas de IRIS.",
    messageEn: "Guardian blocked an attempt to extract IRIS's internal instructions.",
  },
  {
    code: "SSRF_METADATA",
    re: /(169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254|\/latest\/meta-data|100\.100\.100\.200)/i,
    messageEs: "Guardian bloqueó un intento de alcanzar servicios internos de metadatos.",
    messageEn: "Guardian blocked an attempt to reach internal metadata services.",
  },
];

/**
 * Normaliza un texto antes de aplicar los regex de Guardian, para que una
 * paráfrasis o un truco tipográfico no esquive el bloqueo:
 * NFKC, minúsculas, sin diacríticos, sin caracteres de ancho cero,
 * leetspeak habitual (0->o, 1->i, 3->e, 4->a, 5->s, 7->t, @->a, $->s),
 * letras sueltas separadas por espacios unidas, y puntuación/espacios
 * repetidos colapsados a un solo espacio. La muestra original también se
 * comprueba, para no perder patrones con puntuación (rm -rf, /bin/sh).
 */
export function normalizeForGuardian(text: string): string {
  let next = String(text || "").normalize("NFKC").toLowerCase();
  next = next.replace(/[\u200b-\u200f\ufeff]/g, "");
  next = next.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  next = next.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/@/g, "a").replace(/\$/g, "s");
  // "i g n o r e" -> "ignore": secuencias de letras sueltas separadas por espacios.
  next = next.replace(/\b(?:[a-z]\s+){2,}[a-z]\b/g, match => match.replace(/\s+/g, ""));
  next = next.replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return next;
}

// Patrones sobre texto sin espacios ni puntuación ("ignoreprevious").
const SQUASHED_PATTERNS: Array<{ code: string; re: RegExp }> = [
  { code: "IGNORE_PRIOR", re: /(ignore|disregard|olvida|bypass)(previous|prior|anteriores|system|instrucciones|rules|guardian)/ },
  { code: "ROLE_HIJACK", re: /(youarenow|actas|pretendtobe|eresahora)(unrestricted|root|admin|sinlimites|jailbreak)/ },
  { code: "SECRET_EXFIL", re: /(exfiltrat|dump|filtra|revela|print)(apikey|secret|password|token|credential|env)/ },
  { code: "CORE_MUTATION", re: /(selfmodify|modificaelnucleo|rewritecore|patchmain|gitpush)/ },
  { code: "PROMPT_LEAK", re: /(reveal|show|print|repeat|muestra|muestrame|revela|repite)(thesystemprompt|systemprompt|elpromptdelsistema|promptdelsistema|tusinstrucciones|yourinstructions)/ },
];

// Tamaño máximo absoluto de entrada que Guardian procesará (protege contra
// denegación de servicio por payloads enormes), muy por encima de cualquier
// mensaje legítimo de usuario.
const MAX_GUARDIAN_INPUT = 200_000;
// Tamaño de cada ventana de análisis y solape entre ventanas. El solape debe
// cubrir la distancia máxima de cualquier patrón (los más largos usan
// [\s\S]{0,40} entre palabras clave), con margen.
const WINDOW_SIZE = 8_000;
const WINDOW_OVERLAP = 200;

function* slidingWindows(text: string): Generator<string> {
  if (text.length <= WINDOW_SIZE) {
    yield text;
    return;
  }
  const step = WINDOW_SIZE - WINDOW_OVERLAP;
  for (let start = 0; start < text.length; start += step) {
    yield text.slice(start, start + WINDOW_SIZE);
    if (start + WINDOW_SIZE >= text.length) break;
  }
}

/**
 * Revisa una ventana ya normalizada/comprimida contra los patrones de
 * Guardian. No decide el truncado ni el muestreo: eso lo hace
 * detectPromptInjection, que puede llamar esta función varias veces sobre
 * distintas ventanas del mismo texto para que un relleno largo antes de la
 * frase gatillo no evada la detección.
 */
function scanWindow(sample: string, language: "es" | "en"): InjectionFinding | null {
  const normalized = normalizeForGuardian(sample);
  const squashed = normalized.replace(/[^a-z0-9]/g, "");
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(sample) || pattern.re.test(normalized)) {
      return {
        blocked: true,
        code: pattern.code,
        message: language === "es" ? pattern.messageEs : pattern.messageEn,
      };
    }
  }
  return scanSquashed(squashed, language);
}

function scanSquashed(squashed: string, language: "es" | "en"): InjectionFinding | null {
  for (const pattern of SQUASHED_PATTERNS) {
    if (pattern.re.test(squashed)) {
      const base = INJECTION_PATTERNS.find(item => item.code === pattern.code);
      return {
        blocked: true,
        code: `${pattern.code}_PARAPHRASE`,
        message: language === "es" ? (base?.messageEs || "Guardian bloqueó un intento de evasión.") : (base?.messageEn || "Guardian blocked an evasion attempt."),
      };
    }
  }
  return null;
}

export function detectPromptInjection(text: string, language: "es" | "en" = "es"): InjectionFinding {
  const full = String(text || "");
  if (!full.trim()) {
    return { blocked: false, code: "EMPTY", message: "" };
  }
  // Falla cerrado: un texto mayor que MAX_GUARDIAN_INPUT no se recorta (lo
  // que quedara fuera no se analizaría y reabriría el bypass por relleno);
  // se bloquea entero.
  if (full.length > MAX_GUARDIAN_INPUT) {
    return {
      blocked: true,
      code: "OVERSIZE",
      message: language === "es"
        ? "Guardian bloqueó una entrada demasiado grande para analizarla completa."
        : "Guardian blocked an input too large to scan completely.",
    };
  }
  // Antes, un payload con relleno antes de la frase gatillo podía superar los
  // primeros 8000 caracteres y quedar fuera de la única muestra analizada.
  // Ahora se recorre todo el texto en ventanas solapadas, así ninguna sección
  // del mensaje escapa al análisis.
  for (const window of slidingWindows(full)) {
    const finding = scanWindow(window, language);
    if (finding) return finding;
  }
  // Los patrones comprimidos ignoran espacios y puntuación, así que un
  // relleno largo de separadores ("self" + 500 espacios + "modify") puede
  // caer entre dos ventanas. Se repiten sobre el texto completo comprimido.
  const squashedFull = normalizeForGuardian(full).replace(/[^a-z0-9]/g, "");
  const squashedFinding = scanSquashed(squashedFull, language);
  if (squashedFinding) return squashedFinding;
  // Una orden escondida en base64 o en %xx tampoco pasa: se decodifica un
  // nivel y se analiza con los mismos patrones.
  for (const decoded of decodedPayloads(full)) {
    const finding = scanWindow(decoded, language) || scanSquashed(normalizeForGuardian(decoded).replace(/[^a-z0-9]/g, ""), language);
    if (finding) {
      return {
        blocked: true,
        code: `${finding.code.replace(/_PARAPHRASE$/, "")}_ENCODED`,
        message: language === "es"
          ? `${finding.message} (venía codificado).`
          : `${finding.message} (it was encoded).`,
      };
    }
  }
  return { blocked: false, code: "CLEAN", message: "" };
}

const MAX_DECODED_SEGMENTS = 20;

/** Segmentos base64 (≥ 24 caracteres) y texto con %xx, decodificados un nivel. */
export function decodedPayloads(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9+/_-]{24,}={0,2}/g)) {
    if (out.length >= MAX_DECODED_SEGMENTS) break;
    const decoded = tryBase64(match[0]);
    if (decoded) out.push(decoded);
  }
  if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      const decoded = decodeURIComponent(text.replace(/%(?![0-9a-f]{2})/gi, "%25"));
      if (decoded !== text) out.push(decoded);
    } catch {
      // %xx inválido: no hay nada que decodificar
    }
  }
  return out;
}

function tryBase64(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Solo texto legible: evita tratar hashes o binarios como instrucciones.
    const printable = decoded.replace(/[^\x20-\x7e\u00a0-\u024f\s]/g, "");
    return printable.length >= decoded.length * 0.9 && /[a-z]{3,}\s+[a-z]{3,}/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export type AttackSignal = { code: string; severity: "low" | "medium" | "high"; label: string };

const ATTACK_SIGNALS: Array<{ code: string; severity: AttackSignal["severity"]; re: RegExp; labelEs: string; labelEn: string }> = [
  { code: "SQL_INJECTION_PROBE", severity: "medium", re: /('|")\s*(or|and)\s*('?\d+'?\s*=\s*'?\d+|'[^']*'\s*=\s*')|\bunion\s+(all\s+)?select\b|;\s*drop\s+table\b/i, labelEs: "sonda de inyección SQL", labelEn: "SQL injection probe" },
  { code: "XSS_PROBE", severity: "medium", re: /<\s*script\b|javascript\s*:|\bon(error|load|mouseover)\s*=|<\s*iframe\b/i, labelEs: "sonda de XSS", labelEn: "XSS probe" },
  { code: "PATH_TRAVERSAL_PROBE", severity: "medium", re: /(\.\.[/\\]){2,}|\/etc\/(passwd|shadow)\b|%2e%2e%2f/i, labelEs: "intento de recorrer rutas del servidor", labelEn: "path traversal attempt" },
  { code: "TEMPLATE_INJECTION_PROBE", severity: "low", re: /\{\{\s*[^}]*(constructor|__proto__|process|require)\b|\$\{\s*jndi:/i, labelEs: "sonda de inyección de plantillas", labelEn: "template injection probe" },
];

/**
 * Señales de ataque que NO bloquean (IRIS es una consola de seguridad y se
 * puede preguntar por ellas), pero se registran para rastrear a quien sondea.
 */
export function detectAttackSignals(text: string, language: "es" | "en" = "es"): AttackSignal[] {
  const sample = String(text || "").slice(0, MAX_GUARDIAN_INPUT);
  return ATTACK_SIGNALS
    .filter(signal => signal.re.test(sample))
    .map(signal => ({ code: signal.code, severity: signal.severity, label: language === "es" ? signal.labelEs : signal.labelEn }));
}

/**
 * Revisa la conversación completa que envía el cliente, no solo el último
 * mensaje del usuario. Todo el historial (incluidos los mensajes con rol
 * "assistant", que el cliente puede falsificar) llega al modelo.
 *
 * - El último mensaje del usuario decide `finding`: si está marcado, la
 *   petición se bloquea como antes.
 * - Cualquier mensaje anterior marcado se quita del historial en vez de
 *   bloquear la petición. Así una inyección escondida en el historial nunca
 *   llega al modelo, y una conversación que ya tuvo un bloqueo (o una
 *   respuesta legítima de IRIS que menciona "curl") no queda bloqueada
 *   para siempre.
 */
export function guardConversation<T extends { role: string; content: string }>(
  messages: T[],
  language: "es" | "en" = "es",
): { finding: InjectionFinding; messages: T[]; dropped: number } {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") { lastUserIndex = index; break; }
  }
  const lastUser = lastUserIndex >= 0 ? messages[lastUserIndex].content : "";
  const finding = detectPromptInjection(lastUser, language);
  const kept = messages.filter((message, index) => index === lastUserIndex || !detectPromptInjection(message.content, language).blocked);
  return { finding, messages: kept, dropped: messages.length - kept.length };
}

export function guardianAllowsPayload(text: string, language: "es" | "en" = "es") {
  const finding = detectPromptInjection(text, language);
  return !finding.blocked;
}
