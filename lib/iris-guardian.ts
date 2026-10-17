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
];

export function detectPromptInjection(text: string, language: "es" | "en" = "es"): InjectionFinding {
  const sample = String(text || "").slice(0, 8000);
  if (!sample.trim()) {
    return { blocked: false, code: "EMPTY", message: "" };
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.re.test(sample)) {
      return {
        blocked: true,
        code: pattern.code,
        message: language === "es" ? pattern.messageEs : pattern.messageEn,
      };
    }
  }
  return { blocked: false, code: "CLEAN", message: "" };
}

export function guardianAllowsPayload(text: string, language: "es" | "en" = "es") {
  const finding = detectPromptInjection(text, language);
  return !finding.blocked;
}
