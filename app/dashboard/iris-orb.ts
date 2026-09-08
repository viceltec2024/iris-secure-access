export type OrbMode = "ready" | "listening" | "thinking" | "speaking";

export function orbWaveEnergy(mode: OrbMode, hearing: boolean, level = 0) {
  const voice = Math.min(1, Math.max(0, level) * 4.8);
  if (mode === "speaking") return 0.78 + voice * 0.22;
  if (mode === "thinking") return 0.42;
  if (mode === "listening") return hearing ? 0.7 + voice * 0.3 : 0.34 + voice * 0.4;
  return 0.18;
}

export function orbTint(mode: OrbMode, hearing: boolean) {
  if (mode === "thinking") return { core: [255, 214, 140], glow: [168, 96, 255], rim: [120, 82, 210] };
  if (mode === "speaking") return { core: [230, 250, 255], glow: [40, 190, 255], rim: [90, 210, 255] };
  if (mode === "listening" && hearing) return { core: [210, 255, 240], glow: [70, 230, 190], rim: [90, 240, 210] };
  if (mode === "listening") return { core: [190, 240, 255], glow: [50, 160, 255], rim: [80, 200, 255] };
  return { core: [180, 220, 255], glow: [70, 90, 255], rim: [120, 140, 255] };
}

export function orbWaveY(x: number, time: number, energy: number) {
  const envelope = Math.exp(-x * x * 2.15);
  const primary = Math.sin(x * 7.2 + time * 2.15) * 0.62;
  const secondary = Math.sin(x * 14.5 - time * 1.35) * 0.22;
  const tertiary = Math.sin(x * 3.1 + time * 0.55) * 0.16;
  return (primary + secondary + tertiary) * envelope * (0.16 + energy * 0.84);
}
