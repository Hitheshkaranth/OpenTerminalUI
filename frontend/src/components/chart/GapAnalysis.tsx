
import React from "react";

export interface GapInfo {
  previousClose: number;
  preMarketHigh: number;
  preMarketLow: number;
  openPrice: number;
  gapAmount: number;
  gapPercent: number;
  gapType: "gap_up" | "gap_down" | "flat";
  gapFilled: boolean;
}

interface GapBadgeProps {
  gap: GapInfo;
}

export const GapBadge: React.FC<GapBadgeProps> = ({ gap }) => (
  <div className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
    gap.gapType === "gap_up" ? "bg-green-900/40 text-green-400 border border-green-800/50" :
    gap.gapType === "gap_down" ? "bg-red-900/40 text-red-400 border border-red-800/50" :
    "bg-gray-800 text-gray-400 border border-gray-700"
  }`}>
    <span className="opacity-70">GAP</span>
    <span>
      {gap.gapType === "gap_up" ? "▲" : gap.gapType === "gap_down" ? "▼" : "─"}
    </span>
    <span>
      {gap.gapPercent > 0 ? "+" : ""}{gap.gapPercent.toFixed(2)}%
    </span>
    {gap.gapFilled && (
      <span className="ml-1 text-[8px] bg-blue-900/40 text-blue-300 px-1 rounded border border-blue-800/30">
        FILLED
      </span>
    )}
  </div>
);
