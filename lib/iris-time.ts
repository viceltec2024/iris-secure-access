const DEFAULT_TIME_ZONE = "America/New_York";

export function formatUtcClock(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

/** Accept a browser IANA zone; fall back to US Eastern when missing or invalid. */
export function resolveIrisTimeZone(value: unknown) {
  if (typeof value !== "string") return DEFAULT_TIME_ZONE;
  const zone = value.trim();
  if (!/^[A-Za-z0-9_+\-/]{3,64}$/.test(zone)) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function formatParts(language: "es" | "en", timeZone: string, now: Date) {
  const locale = language === "es" ? "es-US" : "en-US";
  const zone = resolveIrisTimeZone(timeZone);
  return {
    zone,
    weekday: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: zone }).format(now),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(now),
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: language === "en", timeZone: zone }).format(now),
  };
}

/** Live clock line injected into IRIS model instructions and local date answers. */
export function clockContext(language: "es" | "en", now = new Date(), timeZone: string = DEFAULT_TIME_ZONE) {
  const { zone, weekday, date, time } = formatParts(language, timeZone, now);
  const iso = now.toISOString();
  if (language === "es") {
    return `Ahora mismo es ${weekday}, ${date}, ${time} zona ${zone}. Referencia UTC: ${iso}. Si el usuario pregunta qué día es hoy, responde con ese día y fecha en su zona horaria (${zone}). No inventes otra zona ni otro país.`;
  }
  return `Right now it is ${weekday}, ${date}, ${time} in time zone ${zone}. UTC reference: ${iso}. If the user asks what day it is today, answer with that weekday and date in their time zone (${zone}). Do not invent another zone or country.`;
}

export function answerCurrentDate(language: "es" | "en", now = new Date(), timeZone: string = DEFAULT_TIME_ZONE) {
  const { zone, weekday, date, time } = formatParts(language, timeZone, now);
  if (language === "es") {
    return `Hoy es ${weekday}, ${date}. Son las ${time} (${zone}).`;
  }
  return `Today is ${weekday}, ${date}. It is ${time} (${zone}).`;
}
