"use client";

import { useEffect, useRef } from "react";
import { irisPupilScale, orbTint, orbWaveEnergy, orbWaveY, type OrbMode } from "./iris-orb";

type Particle = { x: number; z: number; row: number; col: number };

function createField(dense: boolean) {
  const particles: Particle[] = [];
  const columns = dense ? 46 : 22;
  const rows = dense ? 26 : 12;
  for (let col = 0; col <= columns; col += 1) {
    for (let row = 0; row <= rows; row += 1) {
      const x = (col / columns) * 2 - 1;
      const z = (row / rows) * 2 - 1;
      if (x * x * 0.86 + z * z > 0.92) continue;
      particles.push({ x, z, row, col });
    }
  }
  return particles;
}

export default function IrisSystemOrb({
  mode,
  hearing = false,
  level = 0,
  size = 236,
}: {
  mode: OrbMode;
  hearing?: boolean;
  level?: number;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const hearingRef = useRef(hearing);
  const levelRef = useRef(level);
  modeRef.current = mode;
  hearingRef.current = hearing;
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dense = size >= 120;
    const field = createField(dense);
    const rows = new Map<number, Particle[]>();
    for (const particle of field) {
      const list = rows.get(particle.row) || [];
      list.push(particle);
      rows.set(particle.row, list);
    }
    for (const list of rows.values()) list.sort((a, b) => a.x - b.x);

    let frame = 0;
    const start = performance.now();

    const paint = (now: number) => {
      const time = (now - start) / 1000;
      const energy = orbWaveEnergy(modeRef.current, hearingRef.current, levelRef.current);
      const tint = orbTint(modeRef.current, hearingRef.current);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(size * ratio);
      const height = Math.round(size * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const center = width / 2;
      const radius = width * 0.4;
      const pupil = irisPupilScale(energy);

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(center, center);

      const aura = context.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius * 1.42);
      aura.addColorStop(0, `rgba(${tint.glow.join(",")},${0.28 + energy * 0.22})`);
      aura.addColorStop(0.45, `rgba(${tint.ribbon.join(",")},0.12)`);
      aura.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = aura;
      context.beginPath();
      context.arc(0, 0, radius * 1.42, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.clip();

      const voidFill = context.createRadialGradient(-radius * 0.18, -radius * 0.22, radius * 0.08, 0, 0, radius);
      voidFill.addColorStop(0, "rgba(16, 14, 48, 1)");
      voidFill.addColorStop(0.42, "rgba(6, 6, 24, 1)");
      voidFill.addColorStop(1, "rgba(1, 1, 8, 1)");
      context.fillStyle = voidFill;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);

      for (let band = 0; band < 5; band += 1) {
        context.save();
        context.rotate(time * (0.12 + band * 0.045) + band * 0.85);
        context.globalAlpha = 0.14 + energy * 0.1;
        context.strokeStyle = band % 2 ? `rgba(${tint.ribbon.join(",")},0.85)` : `rgba(${tint.glow.join(",")},0.75)`;
        context.lineWidth = (6 - band) * ratio;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(-radius * 0.72, radius * 0.08);
        context.bezierCurveTo(-radius * 0.2, -radius * (0.42 + band * 0.04), radius * 0.18, radius * (0.38 - band * 0.05), radius * 0.74, -radius * 0.06);
        context.stroke();
        context.restore();
      }

      const fiberCount = dense ? 36 : 18;
      for (let index = 0; index < fiberCount; index += 1) {
        const angle = (index / fiberCount) * Math.PI * 2 + time * 0.08;
        const inner = radius * (pupil + 0.04);
        const outer = radius * (0.78 + Math.sin(time * 0.9 + index) * 0.03);
        context.strokeStyle = `rgba(${tint.ribbon.join(",")},${0.1 + energy * 0.08})`;
        context.lineWidth = 0.8 * ratio;
        context.beginPath();
        context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        context.quadraticCurveTo(
          Math.cos(angle + 0.08) * radius * 0.42,
          Math.sin(angle + 0.08) * radius * 0.42,
          Math.cos(angle) * outer,
          Math.sin(angle) * outer,
        );
        context.stroke();
      }

      context.strokeStyle = `rgba(${tint.core.join(",")},${0.16 + energy * 0.18})`;
      context.lineWidth = 0.55 * ratio;
      for (const list of rows.values()) {
        context.beginPath();
        list.forEach((particle, index) => {
          const px = particle.x * radius * 0.9;
          const py = orbWaveY(particle.x, particle.z, time, energy) * radius * 0.7 + particle.z * radius * 0.12;
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        });
        context.stroke();
      }

      for (const particle of field) {
        const wave = orbWaveY(particle.x, particle.z, time, energy);
        const px = particle.x * radius * 0.9;
        const py = wave * radius * 0.7 + particle.z * radius * 0.12;
        const crest = Math.exp(-(particle.x * particle.x * 3.2 + Math.abs(wave) * 1.6));
        const depth = 1 - Math.abs(particle.z) * 0.55;
        const alpha = (0.18 + depth * 0.45 + crest * (0.4 + energy * 0.45)) * (0.75 + energy * 0.25);
        const dot = (0.55 + depth * 1.1 + crest * 1.6 * energy) * ratio;
        const mix = crest * energy;
        const color = [
          Math.round(tint.glow[0] + (tint.core[0] - tint.glow[0]) * mix),
          Math.round(tint.glow[1] + (tint.core[1] - tint.glow[1]) * mix),
          Math.round(tint.glow[2] + (tint.core[2] - tint.glow[2]) * mix),
        ];
        context.fillStyle = `rgba(${color.join(",")},${Math.min(1, alpha)})`;
        context.beginPath();
        context.arc(px, py, Math.max(0.4 * ratio, dot), 0, Math.PI * 2);
        context.fill();
      }

      const pupilGlow = context.createRadialGradient(0, 0, radius * 0.02, 0, 0, radius * (pupil + 0.18));
      pupilGlow.addColorStop(0, `rgba(255,255,255,${0.55 + energy * 0.35})`);
      pupilGlow.addColorStop(0.35, `rgba(${tint.core.join(",")},0.28)`);
      pupilGlow.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = pupilGlow;
      context.beginPath();
      context.arc(0, 0, radius * (pupil + 0.18), 0, Math.PI * 2);
      context.fill();

      const glass = context.createRadialGradient(-radius * 0.34, -radius * 0.4, 2 * ratio, -radius * 0.12, -radius * 0.22, radius * 0.7);
      glass.addColorStop(0, "rgba(255,255,255,0.34)");
      glass.addColorStop(0.18, "rgba(200,220,255,0.08)");
      glass.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = glass;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.save();
      context.translate(center, center);
      context.strokeStyle = `rgba(${tint.rim.join(",")},0.78)`;
      context.lineWidth = 2.4 * ratio;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = `rgba(${tint.ribbon.join(",")},0.25)`;
      context.lineWidth = 6 * ratio;
      context.beginPath();
      context.arc(0, 0, radius * 1.02, 0, Math.PI * 2);
      context.stroke();
      context.restore();

      if (!reduced) frame = requestAnimationFrame(paint);
    };

    paint(start);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return (
    <div className={`iris-system-orb ${mode}${hearing ? " hearing" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
