"use client";

import { useEffect, useRef } from "react";
import { orbTint, orbWaveEnergy, orbWaveY, type OrbMode } from "./iris-orb";

type Particle = { x: number; z: number };

function createField() {
  const particles: Particle[] = [];
  for (let column = -18; column <= 18; column += 1) {
    for (let depth = -7; depth <= 7; depth += 1) {
      const x = column / 18;
      const z = depth / 9;
      if (x * x + z * z > 0.96) continue;
      particles.push({ x, z });
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
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const field = createField();
    let frame = 0;
    let start = performance.now();

    const paint = (now: number) => {
      const time = (now - start) / 1000;
      const energy = orbWaveEnergy(modeRef.current, hearingRef.current, levelRef.current);
      const tint = orbTint(modeRef.current, hearingRef.current);
      const ratio = window.devicePixelRatio || 1;
      const width = size * ratio;
      const height = size * ratio;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const center = width / 2;
      const radius = width * 0.42;

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(center, center);

      const glow = context.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.35);
      glow.addColorStop(0, `rgba(${tint.glow.join(",")},${0.22 + energy * 0.2})`);
      glow.addColorStop(0.55, `rgba(${tint.glow.join(",")},0.08)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(0, 0, radius * 1.35, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.clip();

      const interior = context.createRadialGradient(-radius * 0.2, -radius * 0.25, radius * 0.1, 0, 0, radius);
      interior.addColorStop(0, "rgba(18, 28, 72, 0.95)");
      interior.addColorStop(0.45, "rgba(6, 10, 32, 0.96)");
      interior.addColorStop(1, "rgba(2, 4, 16, 1)");
      context.fillStyle = interior;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);

      for (let band = 0; band < 3; band += 1) {
        const angle = time * (0.18 + band * 0.07) + band * 1.3;
        context.save();
        context.rotate(angle);
        context.globalAlpha = 0.18 + energy * 0.12;
        const mist = context.createRadialGradient(radius * 0.15, 0, 8 * ratio, radius * 0.15, 0, radius * 0.72);
        mist.addColorStop(0, band === 1 ? "rgba(170,90,255,0.7)" : `rgba(${tint.glow.join(",")},0.55)`);
        mist.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = mist;
        context.beginPath();
        context.ellipse(radius * 0.08, 0, radius * 0.72, radius * (0.18 + band * 0.05), 0.4, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      for (const particle of field) {
        const wave = orbWaveY(particle.x, time, energy);
        const px = particle.x * radius * 0.9;
        const py = wave * radius * 0.72 + particle.z * radius * 0.16;
        const depth = 1 - Math.abs(particle.z);
        const brightness = 0.22 + depth * 0.55 + Math.max(0, 1 - Math.abs(wave) * 2.4) * 0.35 * energy;
        const dot = (0.7 + depth * 1.4 + energy * 0.8) * ratio;
        context.fillStyle = `rgba(${tint.core.join(",")},${brightness})`;
        context.beginPath();
        context.arc(px, py, dot, 0, Math.PI * 2);
        context.fill();
      }

      const shine = context.createRadialGradient(-radius * 0.32, -radius * 0.38, 4 * ratio, -radius * 0.18, -radius * 0.28, radius * 0.55);
      shine.addColorStop(0, "rgba(255,255,255,0.22)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = shine;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.save();
      context.translate(center, center);
      context.strokeStyle = `rgba(${tint.rim.join(",")},0.7)`;
      context.lineWidth = 2.2 * ratio;
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,0.28)";
      context.lineWidth = 1.2 * ratio;
      context.beginPath();
      context.arc(-radius * 0.08, -radius * 0.08, radius * 0.96, Math.PI * 1.1, Math.PI * 1.65);
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
