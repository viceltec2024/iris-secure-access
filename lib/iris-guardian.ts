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
    re: /\b(ignore|ignor[a-z]*|olvid[a-z]*|disregard|bypass|omit[a-z]*)\b[\s\S]{0,40}\b(previous|prior|anteriores?|anterior|system|sistema|instrucciones?|rules?|reglas|guardian)\b/i,
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
    re: /\b(exfiltrat[a-z]*|dump|filtr[a-z]*|revel[a-z]*|print|muestra|ense[a-z]*|dame|comparte|env[ií]a)\b[\s\S]{0,40}(?:\b(api[\s_-]?key|secrets?|passwords?|tokens?|credentials?|claves?|contrase[nñ]as?)\b|\.env\b)/i,
    messageEs: "Guardian bloqueó un intento de exfiltración de secretos.",
    messageEn: "Guardian blocked a secret-exfiltration attempt.",
  },
  {
    code: "CORE_MUTATION",
    re: /\b(self[_-]?modify|modif\w*\s+el\s+n[uú]cleo|rewrite core|patch main|git push|--force)\b/i,
    messageEs: "Guardian bloqueó una solicitud de modificar el núcleo de IRIS.",
    messageEn: "Guardian blocked a request to modify IRIS core.",
  },
  {
    code: "SHELL_ESCAPE",
    re: /\b(rm\s+-rf|curl\s+|wget\s+|child_process|\/bin\/sh|powershell|Invoke-Expression)\b/i,
    messageEs: "Guardian bloqueó patrones de shell o escape.",
    messageEn: "Guardian blocked shell/escape patterns.",
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
  { code: "IGNORE_PRIOR", re: /(ignore|disregard|olvida|bypass|ignora|ignorar)(previous|prior|anteriores|anterior|system|sistema|instrucciones|rules|reglas|guardian)/ },
  { code: "ROLE_HIJACK", re: /(youarenow|actas|pretendtobe|eresahora)(unrestricted|root|admin|sinlimites|jailbreak)/ },
  { code: "SECRET_EXFIL", re: /(exfiltrat|exfiltrate|dump|filtra|revela|print|muestra|ensena|dame|comparte|envia)(apikey|secret|password|token|credential|env|clave|contrasena)/ },
  { code: "CORE_MUTATION", re: /(selfmodify|modif[a-z]*elnucleo|rewritecore|patchmain|gitpush)/ },
];

export function detectPromptInjection(text: string, language: "es" | "en" = "es"): InjectionFinding {
  const sample = String(text || "").slice(0, 8000);
  if (!sample.trim()) {
    return { blocked: false, code: "EMPTY", message: "" };
  }
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
  return { blocked: false, code: "CLEAN", message: "" };
}

export function guardianAllowsPayload(text: string, language: "es" | "en" = "es") {
  const finding = detectPromptInjection(text, language);
  return !finding.blocked;
}
