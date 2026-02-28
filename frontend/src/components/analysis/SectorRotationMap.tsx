import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSectorRotation } from "../../api/client";
import { useNavigate } from "react-router-dom";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { Play, Pause } from "lucide-react";

type Props = {
  defaultBenchmark?: string;
  width?: number | string;
  height?: number | string;
};

export function SectorRotationMap({ defaultBenchmark = "SPY", width = "100%", height = 400 }: Props) {
  const navigate = useNavigate();
  const [benchmark, setBenchmark] = useState(defaultBenchmark);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sector-rotation", benchmark],
    queryFn: () => fetchSectorRotation(benchmark),
    refetchInterval: 3600_000,
  });

  const processedData = useMemo(() => {
    if (!data?.sectors) return [];

    return data.sectors.map(sector => {
      // Find the appropriate point in time if historyIndex is set
      const trail = sector.trail;
      let currentIdx = trail.length - 1;

      if (historyIndex !== null) {
         currentIdx = Math.min(Math.max(0, historyIndex), trail.length - 1);
      }

      return {
        ...sector,
        current: trail[currentIdx],
        displayTrail: trail.slice(0, currentIdx + 1)
      };
    });
  }, [data, historyIndex]);

  const maxHistory = useMemo(() => {
    if (!data?.sectors?.length) return 0;
    return Math.max(...data.sectors.map(s => s.trail.length)) - 1;
  }, [data]);

  // Handle animation play
  useMemo(() => {
    if (isPlaying) {
      if (historyIndex === null || historyIndex >= maxHistory) {
         setHistoryIndex(0);
      }

      const interval = setInterval(() => {
        setHistoryIndex(prev => {
          const next = (prev ?? 0) + 1;
          if (next >= maxHistory) {
             setIsPlaying(false);
             return maxHistory;
          }
          return next;
        });
      }, 500);

      return () => clearInterval(interval);
    }
  }, [isPlaying, maxHistory, historyIndex]);

  const getQuadrantColor = (x: number, y: number) => {
    if (x >= 100 && y >= 100) return "#22c55e"; // Leading: Green
    if (x >= 100 && y < 100) return "#eab308";  // Weakening: Yellow
    if (x < 100 && y < 100) return "#ef4444";   // Lagging: Red
    return "#3b82f6";                           // Improving: Blue
  };

  if (isLoading) return <div className="flex h-full items-center justify-center p-8 text-xs text-terminal-muted animate-pulse">CALCULATING RELATIVE ROTATION...</div>;
  if (error) return <div className="p-4 text-xs text-terminal-neg">Failed to load sector rotation data.</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-2 border-b border-terminal-border bg-terminal-panel">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase text-terminal-muted font-bold tracking-wider">Benchmark</span>
          <select
            className="bg-terminal-bg text-[10px] border border-terminal-border rounded px-1 py-0.5 outline-none text-terminal-text uppercase"
            value={benchmark}
            onChange={(e) => {
              setBenchmark(e.target.value);
              setHistoryIndex(null);
              setIsPlaying(false);
            }}
          >
            <option value="SPY">SPY (US)</option>
            <option value="QQQ">QQQ (US Tech)</option>
            <option value="^NSEI">NIFTY 50 (India)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-1 rounded bg-terminal-bg border border-terminal-border text-terminal-accent hover:bg-terminal-border"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <input
            type="range"
            min={0}
            max={maxHistory}
            value={historyIndex ?? maxHistory}
            onChange={(e) => {
              setHistoryIndex(parseInt(e.target.value));
              setIsPlaying(false);
            }}
            className="w-24 md:w-32 accent-terminal-accent"
          />
          <span className="text-[9px] text-terminal-muted font-mono w-16 text-right">
             {processedData[0]?.current?.date || "-"}
          </span>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-[#0a0a0a]" style={{ width, height, minHeight: 300 }}>
        <svg width="100%" height="100%" viewBox="80 80 40 40" preserveAspectRatio="xMidYMid meet" className="absolute inset-0">
          <defs>
            <marker id="arrowhead" markerWidth="3" markerHeight="3" refX="2.5" refY="1.5" orient="auto">
              <polygon points="0 0, 3 1.5, 0 3" fill="currentColor" className="text-terminal-muted" />
            </marker>
          </defs>

          {/* Quadrants Backgrounds */}
          <rect x="100" y="80" width="25" height="20" fill="#22c55e" opacity="0.05" />
          <rect x="100" y="100" width="25" height="25" fill="#eab308" opacity="0.05" />
          <rect x="75" y="100" width="25" height="25" fill="#ef4444" opacity="0.05" />
          <rect x="75" y="80" width="25" height="20" fill="#3b82f6" opacity="0.05" />

          {/* Axes */}
          <line x1="75" y1="100" x2="125" y2="100" stroke="#333" strokeWidth="0.2" />
          <line x1="100" y1="80" x2="100" y2="125" stroke="#333" strokeWidth="0.2" />

          {/* Quadrant Labels */}
          <text x="123" y="82" fontSize="1.5" fill="#22c55e" opacity="0.3" textAnchor="end">LEADING</text>
          <text x="123" y="123" fontSize="1.5" fill="#eab308" opacity="0.3" textAnchor="end">WEAKENING</text>
          <text x="77" y="123" fontSize="1.5" fill="#ef4444" opacity="0.3" textAnchor="start">LAGGING</text>
          <text x="77" y="82" fontSize="1.5" fill="#3b82f6" opacity="0.3" textAnchor="start">IMPROVING</text>

          {/* Axis Labels */}
          <text x="124" y="99.5" fontSize="1" fill="#666" textAnchor="end">RS-Ratio</text>
          <text x="100.5" y="81" fontSize="1" fill="#666" textAnchor="start">RS-Momentum</text>

          {/* Trails and Points */}
          {processedData.map((sector) => {
            if (!sector.current) return null;
            const isHovered = hoveredSymbol === sector.symbol;
            const isFaded = hoveredSymbol !== null && !isHovered;

            // Invert Y axis for standard chart coords where origin is top-left
            // RRG has 100,100 center.
            // SVG: higher Y is lower down. RS-Mom > 100 should be visually higher (lower Y).
            // So we map Y: SVG_Y = 100 - (RS_Mom - 100).
            const mapY = (y: number) => 100 - (y - 100);

            const trailPoints = sector.displayTrail.map(p => `${p.x},${mapY(p.y)}`).join(" ");
            const color = getQuadrantColor(sector.current.x, sector.current.y);

            return (
              <g
                key={sector.symbol}
                opacity={isFaded ? 0.2 : 1}
                onMouseEnter={() => setHoveredSymbol(sector.symbol)}
                onMouseLeave={() => setHoveredSymbol(null)}
                onClick={() => navigate(`/equity/stocks?ticker=${encodeURIComponent(sector.symbol)}`)}
                className="cursor-pointer transition-opacity duration-300"
              >
                {/* Trail Line */}
                {sector.displayTrail.length > 1 && (
                  <polyline
                    points={trailPoints}
                    fill="none"
                    stroke={color}
                    strokeWidth={isHovered ? "0.4" : "0.2"}
                    opacity={isHovered ? 0.8 : 0.4}
                    markerEnd="url(#arrowhead)"
                  />
                )}

                {/* Current Dot */}
                <circle
                  cx={sector.current.x}
                  cy={mapY(sector.current.y)}
                  r={isHovered ? "0.8" : "0.5"}
                  fill={color}
                  stroke="#111"
                  strokeWidth="0.1"
                />

                {/* Label */}
                <text
                  x={sector.current.x + 0.8}
                  y={mapY(sector.current.y) + 0.3}
                  fontSize={isHovered ? "1.2" : "0.8"}
                  fill="#fff"
                  fontWeight="bold"
                  className="pointer-events-none select-none"
                  style={{ textShadow: "0px 0px 2px #000" }}
                >
                  {sector.symbol}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
