export type OrbMode = "ready" | "listening" | "thinking" | "speaking";

export function orbWaveEnergy(mode: OrbMode, hearing: boolean, level = 0) {
  const voice = Math.min(1, Math.max(0, level) * 4.8);
  if (mode === "speaking") return 0.82 + voice * 0.18;
  if (mode === "thinking") return 0.48;
  if (mode === "listening") return hearing ? 0.72 + voice * 0.28 : 0.38 + voice * 0.36;
  return 0.22;
}

export function orbTint(mode: OrbMode, hearing: boolean) {
  if (mode === "thinking") return { core: [255, 236, 255], glow: [168, 88, 255], rim: [150, 110, 255], ribbon: [186, 92, 255] };
  if (mode === "speaking") return { core: [255, 255, 255], glow: [70, 170, 255], rim: [120, 210, 255], ribbon: [90, 140, 255] };
  if (mode === "listening" && hearing) return { core: [240, 252, 255], glow: [80, 190, 255], rim: [140, 200, 255], ribbon: [140, 90, 255] };
  if (mode === "listening") return { core: [220, 244, 255], glow: [70, 130, 255], rim: [120, 170, 255], ribbon: [150, 80, 255] };
  return { core: [210, 230, 255], glow: [90, 80, 255], rim: [140, 130, 255], ribbon: [160, 90, 255] };
}

export function orbWaveY(x: number, z: number, time: number, energy: number) {
  const envelope = Math.exp(-(x * x * 2.4 + z * z * 1.1));
  const primary = Math.sin(x * 8.4 + time * 2.05) * 0.7;
  const secondary = Math.sin(x * 16.2 - time * 1.4 + z * 3.2) * 0.18;
  const drift = Math.sin(z * 5.1 + time * 0.7) * 0.1;
  return (primary + secondary + drift) * envelope * (0.18 + energy * 0.92);
}

export function irisPupilScale(energy: number) {
  return 0.16 + energy * 0.11;
}
