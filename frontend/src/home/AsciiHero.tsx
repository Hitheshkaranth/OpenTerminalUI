import { useEffect, useRef } from "react";

export type AsciiHeroProps = {
  className?: string;
  palette?: "amber" | "green";
  quality?: "low" | "med" | "high";
  glow?: number;
};

const RAMP = " .,:;i1tfLCG08@";
const CELL_PX: Record<NonNullable<AsciiHeroProps["quality"]>, number> = {
  low: 14,
  med: 11,
  high: 8
};

const COLOR_BY_PALETTE: Record<NonNullable<AsciiHeroProps["palette"]>, string> = {
  amber: "#ff9f1a",
  green: "#00c176"
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function AsciiHero({
  className,
  palette = "amber",
  quality = "med",
  glow = 0.7
}: AsciiHeroProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const cellPx = CELL_PX[quality];
    const color = COLOR_BY_PALETTE[palette];
    const glowClamped = clamp(glow, 0, 1);

    const viewport = {
      width: 0,
      height: 0,
      dpr: 1,
      cols: 0,
      rows: 0
    };

    const mouse = {
      tx: 0.5,
      ty: 0.5,
      sx: 0.5,
      sy: 0.5,
      lastMoveAt: 0,
      influence: 0
    };

    const setCanvasSize = (width: number, height: number) => {
      viewport.width = Math.max(1, Math.floor(width));
      viewport.height = Math.max(1, Math.floor(height));
      viewport.dpr = Math.max(1, window.devicePixelRatio || 1);
      viewport.cols = Math.max(1, Math.floor(viewport.width / cellPx));
      viewport.rows = Math.max(1, Math.floor(viewport.height / cellPx));

      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.width = Math.max(1, Math.floor(viewport.width * viewport.dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * viewport.dpr));
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const inBounds =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inBounds) return;

      mouse.tx = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      mouse.ty = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      mouse.lastMoveAt = performance.now();
    };

    const onPointerLeave = () => {
      mouse.lastMoveAt = 0;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setCanvasSize(rect.width, rect.height);
    });
    resizeObserver.observe(root);

    const initialRect = root.getBoundingClientRect();
    setCanvasSize(initialRect.width, initialRect.height);

    let rafId = 0;
    let lastNow = performance.now();
    let timeSec = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      timeSec += dt;

      const isMouseActive = now - mouse.lastMoveAt < 700;
      mouse.influence += ((isMouseActive ? 1 : 0) - mouse.influence) * 0.06;
      mouse.sx += (mouse.tx - mouse.sx) * 0.08;
      mouse.sy += (mouse.ty - mouse.sy) * 0.08;

      ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(8, Math.floor(cellPx * 0.9))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = glowClamped > 0 ? 2 + glowClamped * 14 : 0;

      const warpX = (mouse.sx - 0.5) * 0.18 * mouse.influence;
      const warpY = (mouse.sy - 0.5) * 0.18 * mouse.influence;
      const spotlightRadius = 0.34;
      const spotlightStrength = 0.55;
      const freq1 = 10.5;
      const freq2 = 12.4;
      const freq3 = 8.2;
      const speed1 = 0.44;
      const speed2 = 0.37;
      const speed3 = 0.31;

      for (let row = 0; row < viewport.rows; row += 1) {
        const gridY = (row + 0.5) / viewport.rows;
        const sampleY = gridY + warpY * (0.75 - Math.abs(gridY - 0.5));
        const drawY = (row + 0.58) * cellPx;

        for (let col = 0; col < viewport.cols; col += 1) {
          const gridX = (col + 0.5) / viewport.cols;
          const sampleX = gridX + warpX * (0.75 - Math.abs(gridX - 0.5));

          const w1 = Math.sin(sampleX * freq1 + timeSec * speed1);
          const w2 = Math.cos(sampleY * freq2 - timeSec * speed2);
          const w3 = Math.sin((sampleX + sampleY) * freq3 + timeSec * speed3);
          let intensity = ((w1 + w2 + w3) / 3) * 0.5 + 0.5;

          const dx = gridX - mouse.sx;
          const dy = gridY - mouse.sy;
          const dist = Math.hypot(dx, dy);
          const boost = clamp(1 - dist / spotlightRadius, 0, 1);
          intensity = clamp(intensity + boost * spotlightStrength * mouse.influence, 0, 1);

          const idx = Math.min(RAMP.length - 1, Math.floor(intensity * (RAMP.length - 1)));
          const char = RAMP[idx];
          ctx.globalAlpha = 0.2 + intensity * (0.45 + glowClamped * 0.25);
          ctx.fillText(char, (col + 0.5) * cellPx, drawY);
        }
      }

      ctx.globalAlpha = 1;
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [glow, palette, quality]);

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden rounded border border-terminal-border bg-terminal-panel ${className ?? ""}`.trim()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 2px, transparent 4px)"
        }}
      />
    </div>
  );
}
