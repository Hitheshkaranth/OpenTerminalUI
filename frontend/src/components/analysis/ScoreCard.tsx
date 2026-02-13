import React from "react";
import { useScores } from "../../hooks/useStocks";

interface ScoreCardProps {
    ticker: string;
}

const ScoreBadge = ({ label, value, max, inverse = false }: { label: string, value: number, max: number, inverse?: boolean }) => {
    let textColor = "text-terminal-muted";
    let barColor = "bg-terminal-muted/50";
    const pct = max > 0 ? (value / max) * 100 : 0;

    if (!inverse) {
        if (pct >= 80) { textColor = "text-terminal-pos"; barColor = "bg-terminal-pos/50"; }
        else if (pct >= 50) { textColor = "text-terminal-warn"; barColor = "bg-terminal-warn/50"; }
        else { textColor = "text-terminal-neg"; barColor = "bg-terminal-neg/50"; }
    } else {
        if (pct <= 33) { textColor = "text-terminal-pos"; barColor = "bg-terminal-pos/50"; }
        else if (pct <= 66) { textColor = "text-terminal-warn"; barColor = "bg-terminal-warn/50"; }
        else { textColor = "text-terminal-neg"; barColor = "bg-terminal-neg/50"; }
    }

    return (
        <div className="flex flex-col rounded border border-terminal-border bg-terminal-bg p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-terminal-muted">{label}</span>
            <div className={`mt-2 text-2xl font-bold ${textColor}`}>{value?.toFixed(2) ?? "-"}</div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-terminal-border">
                <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}></div>
            </div>
        </div>
    );
}

export const ScoreCard: React.FC<ScoreCardProps> = ({ ticker }) => {
    const { data, isLoading, error } = useScores(ticker);

    if (isLoading) return <div className="h-32 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
    if (error || !data) return <div className="text-terminal-neg">Failed to load scores</div>;

    return (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Fundamental Scorecard</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ScoreBadge label="Piotroski F-Score" value={data.piotroski_f_score} max={9} />
                <ScoreBadge label="Altman Z-Score" value={data.altman_z_score} max={5} />
                <ScoreBadge label="Graham Number" value={data.graham_number} max={data.graham_number * 1.5} />
                <ScoreBadge label="PEG Ratio" value={data.peg_ratio} max={3} inverse />
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                    <h4 className="mb-2 font-medium text-terminal-accent">DuPont Analysis</h4>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                        <div>
                            <div className="text-terminal-muted">Net Margin</div>
                            <div className="font-semibold text-terminal-text">{(data.dupont_analysis.profit_margin * 100).toFixed(2)}%</div>
                        </div>
                        <div>
                            <div className="text-terminal-muted">Asset Turnover</div>
                            <div className="font-semibold text-terminal-text">{data.dupont_analysis.asset_turnover.toFixed(2)}x</div>
                        </div>
                        <div>
                            <div className="text-terminal-muted">Equity Multiplier</div>
                            <div className="font-semibold text-terminal-text">{data.dupont_analysis.equity_multiplier.toFixed(2)}x</div>
                        </div>
                    </div>
                    <div className="mt-2 text-xs font-medium text-terminal-accent">ROE: {(data.dupont_analysis.roe * 100).toFixed(2)}%</div>
                </div>

                <div className="rounded border border-terminal-border bg-terminal-bg p-3">
                    <h4 className="mb-2 font-medium text-terminal-accent">Valuation & Growth</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                            <div className="text-terminal-muted">FCF Yield</div>
                            <div className="font-semibold text-terminal-text">{data.fcf_yield_pct.toFixed(2)}%</div>
                        </div>
                        <div>
                            <div className="text-terminal-muted">Cash Conv. Cycle</div>
                            <div className="font-semibold text-terminal-text">{data.cash_conversion_cycle.toFixed(0)} days</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
