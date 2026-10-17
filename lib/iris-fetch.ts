/**
 * Shared fetch helpers with hard timeouts (no secret logging).
 */

export class IrisTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "IrisTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || controller.signal.aborted)) {
      throw new IrisTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function classifyProviderError(error: unknown): { code: "timeout" | "network" | "unknown"; detail: string } {
  if (error instanceof IrisTimeoutError) {
    return { code: "timeout", detail: error.message };
  }
  if (error instanceof Error) {
    return { code: "network", detail: error.message.slice(0, 240) };
  }
  return { code: "unknown", detail: "unknown_provider_error" };
}
