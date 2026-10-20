/** Mac prep helpers — Windows + Mac live in iris-device-prep.ts */
import { deviceAgentPrepSteps, type DevicePrepStep } from "./iris-device-prep.ts";

export type MacPrepStep = DevicePrepStep;
export type { DevicePrepStep };
export { deviceAgentPrepSteps };

export function macAgentPrepSteps(language: "es" | "en" = "es") {
  return deviceAgentPrepSteps("macOS", language);
}
