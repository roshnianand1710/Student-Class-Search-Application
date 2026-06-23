// Animated galaxy backdrop — canvas starfield plus CSS nebula layers.
import { useEffect, useRef } from 'react';

// Deterministic pseudo-random number generator for a stable star layout.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map a random tint value to pink, green, blue, or white star colors.
function starColor(tint, alpha) {
  if (tint > 0.9) return `rgba(251, 113, 133, ${alpha})`; // pink
  if (tint > 0.82) return `rgba(134, 239, 172, ${alpha})`; // green
  if (tint > 0.74) return `rgba(191, 219, 254, ${alpha})`; // bright blue
  if (tint > 0.66) return `rgba(147, 197, 253, ${alpha})`; // blue
  return `rgba(255, 255, 255, ${alpha})`;
}

// Paint tiny stars, medium dots, and a few glowing bright stars on the canvas.
function drawStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rand = mulberry32(42);

  for (let i = 0; i < 320; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const alpha = rand() * 0.45 + 0.15;
    ctx.fillStyle = starColor(rand(), alpha * 0.85);
    ctx.fillRect(x, y, 1, 1);
  }

  for (let i = 0; i < 180; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rand() * 0.9 + 0.4;
    const alpha = rand() * 0.6 + 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = starColor(rand(), alpha);
    ctx.fill();
  }

  for (let i = 0; i < 24; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rand() * 1.4 + 0.8;
    const alpha = rand() * 0.5 + 0.55;
    const tint = rand();
    const glow =
      tint > 0.7
        ? `rgba(147, 197, 253, ${alpha * 0.65})`
        : tint > 0.4
          ? `rgba(244, 114, 182, ${alpha * 0.42})`
          : `rgba(134, 239, 172, ${alpha * 0.4})`;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.4, glow);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = starColor(tint, alpha);
    ctx.fill();
  }
}

export default function GalaxyBackground() {
  const canvasRef = useRef(null);

  // Draw stars on mount and redraw when the window is resized.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const paint = () => drawStarfield(canvas);
    paint();

    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, []);

  return (
    <div className="galaxy-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="galaxy-stars" />
      <div className="galaxy-band" />
      <div className="galaxy-core" />
      <div className="galaxy-nebula">
        <span className="nebula nebula-1" />
        <span className="nebula nebula-2" />
        <span className="nebula nebula-3" />
        <span className="nebula nebula-4" />
        <span className="nebula nebula-5" />
        <span className="nebula nebula-6" />
        <span className="nebula nebula-7" />
        <span className="nebula nebula-8" />
      </div>
      <div className="galaxy-twinkle">
        <span /><span /><span /><span /><span /><span />
      </div>
    </div>
  );
}
