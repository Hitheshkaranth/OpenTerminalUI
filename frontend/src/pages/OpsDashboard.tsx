import { useEffect, useState } from "react";
import {
  Activity, ShieldAlert, Briefcase,
  RefreshCw, Zap, Database
} from "lucide-react";

import { fetchFeedHealth, fetchKillSwitches, fetchOpsDataQuality, setKillSwitch, type OpsDataQualityReport } from "../api/client";
import type { KillSwitch } from "../types";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTabs } from "../components/terminal/TerminalTabs";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { DataQualityPanel } from "../components/ops/DataQualityPanel";

export function OpsDashboardPage() {
  const [feed, setFeed] = useState<Record<string, unknown>>({});
  const [switches, setSwitches] = useState<KillSwitch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataQuality, setDataQuality] = useState<OpsDataQualityReport | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [health, kill, dq] = await Promise.all([fetchFeedHealth(), fetchKillSwitches(), fetchOpsDataQuality()]);
      setFeed(health);
      setSwitches(kill);
      setDataQuality(dq);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tabs = [
    { id: "trader", label: "TRADER", icon: <Activity size={14} /> },
    { id: "quant", label: "QUANT", icon: <Zap size={14} /> },
    { id: "pm", label: "PM", icon: <Briefcase size={14} /> },
    { id: "risk", label: "RISK", icon: <ShieldAlert size={14} /> },
    { id: "system", label: "SYSTEM", icon: <Database size={14} /> },
  ];

  const [activeTab, setActiveTab] = useState("trader");

  return (
    <div className="space-y-3 p-4 font-mono">
      <div className="flex justify-between items-center rounded border border-terminal-border bg-terminal-panel p-3">
        <div>
          <div className="text-sm font-semibold text-terminal-accent uppercase tracking-wider">Operational Workspace Control</div>
          <div className="text-[10px] text-terminal-muted">System orchestration & role-based action center</div>
        </div>
        <button
          className="rounded border border-terminal-border px-3 py-1 text-xs hover:bg-terminal-border/30 flex items-center gap-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {loading ? "SYNCING..." : "SYNC STATE"}
        </button>
      </div>

      <TerminalTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div className="mt-3">
        {activeTab === "trader" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TerminalPanel title="EXECUTION CONTROL">
              <div className="space-y-3 p-1">
                <div className="text-xs text-terminal-muted mb-2">Active session monitoring & order flow controls.</div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                    <div className="text-terminal-accent font-bold mb-1 uppercase">Flatten All</div>
                    <div className="text-terminal-dim">Emergency exit all active positions.</div>
                  </button>
                  <button className="p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                    <div className="text-terminal-accent font-bold mb-1 uppercase">Cancel Pending</div>
                    <div className="text-terminal-dim">Flush all open orders in OMS.</div>
                  </button>
                </div>
              </div>
            </TerminalPanel>
            <TerminalPanel title="LIVE TAPE">
              <div className="h-32 flex items-center justify-center text-xs text-terminal-dim italic">
                Streaming execution feed...
              </div>
            </TerminalPanel>
          </div>
        )}

        {activeTab === "quant" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TerminalPanel title="MODEL ORCHESTRATION">
              <div className="space-y-2 p-1">
                <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left flex justify-between items-center">
                  <span>DEPLOY ALPHA-V3 TO PRODUCTION</span>
                  <TerminalBadge variant="live">STABLE</TerminalBadge>
                </button>
                <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left flex justify-between items-center">
                  <span>TRIGGER BATCH BACKTEST (UNIVERSE: NIFTY50)</span>
                  <span className="text-terminal-dim">IDLE</span>
                </button>
              </div>
            </TerminalPanel>
            <TerminalPanel title="SIGNAL STATUS">
               <div className="space-y-1 p-1 text-[10px]">
                  <div className="flex justify-between border-b border-terminal-border/30 pb-1">
                    <span className="text-terminal-muted uppercase">Factor Set</span>
                    <span className="text-terminal-muted uppercase">Health</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>MOMENTUM_1M</span>
                    <span className="text-terminal-pos">OK (0.82)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>MEAN_REVERSION_5M</span>
                    <span className="text-terminal-pos">OK (0.45)</span>
                  </div>
               </div>
            </TerminalPanel>
          </div>
        )}

        {activeTab === "pm" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TerminalPanel title="PORTFOLIO REBALANCING">
              <div className="p-1 space-y-2">
                <div className="text-[10px] text-terminal-muted mb-2">Drift monitoring & target weight alignment.</div>
                <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                  GENERATE REBALANCE ORDERS
                </button>
                <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                  EXPORT PERFORMANCE REPORT (PDF)
                </button>
              </div>
            </TerminalPanel>
            <TerminalPanel title="CONCENTRATION LIMITS">
               <div className="space-y-2 p-1 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span>SECTOR: TECHNOLOGY</span>
                    <div className="h-1.5 w-32 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-terminal-pos" style={{ width: '65%' }} />
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>SECTOR: FINANCIALS</span>
                    <div className="h-1.5 w-32 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-terminal-neg" style={{ width: '92%' }} />
                    </div>
                  </div>
               </div>
            </TerminalPanel>
          </div>
        )}

        {activeTab === "risk" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TerminalPanel title="RISK PARAMETERS">
              <div className="p-1 space-y-2">
                <div className="flex justify-between text-[10px] border-b border-terminal-border/20 pb-1">
                  <span>MAX PORTFOLIO VaR</span>
                  <span className="font-bold">2.5%</span>
                </div>
                <div className="flex justify-between text-[10px] border-b border-terminal-border/20 pb-1">
                  <span>MAX ASSET WEIGHT</span>
                  <span className="font-bold">10.0%</span>
                </div>
                <button className="w-full mt-2 p-2 border border-terminal-border bg-terminal-neg/10 hover:bg-terminal-neg/20 text-[10px] text-terminal-neg font-bold">
                  ENGAGE CIRCUIT BREAKER (HARD STOP)
                </button>
              </div>
            </TerminalPanel>
            <TerminalPanel title="STRESS TEST REGIMES">
               <div className="space-y-2 p-1">
                  <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                    SIMULATE 2008 CRASH (-40% EQUITY)
                  </button>
                  <button className="w-full p-2 border border-terminal-border bg-terminal-panel hover:bg-terminal-border/20 text-[10px] text-left">
                    SIMULATE COVID-19 SHOCK
                  </button>
               </div>
            </TerminalPanel>
          </div>
        )}

        {activeTab === "system" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-3">
              <TerminalPanel title="FEED HEALTH">
                <div className="p-1 space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span>Feed State</span>
                    <span className="text-terminal-pos">{String(feed.feed_state || "ACTIVE")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Kite Stream</span>
                    <span className="text-terminal-pos">{String(feed.kite_stream_status || "CONNECTED")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>WS Clients</span>
                    <span>{String(feed.ws_connected_clients || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>WS Subscriptions</span>
                    <span>{String(feed.ws_subscriptions || 0)}</span>
                  </div>
                </div>
              </TerminalPanel>

              <TerminalPanel title="SYSTEM MESSAGES">
                <div className="h-32 overflow-y-auto p-1 text-[10px] text-terminal-muted italic">
                  {message || "No new system alerts."}
                </div>
              </TerminalPanel>

              <DataQualityPanel report={dataQuality} loading={loading} />
            </div>

            <TerminalPanel title="KILL SWITCHES">
              <div className="space-y-2 p-1">
                {switches.length === 0 && (
                  <div className="text-xs text-terminal-dim italic p-2">No active kill switches configured.</div>
                )}
                {switches.map((sw) => (
                  <div key={sw.id} className="flex items-center justify-between border-b border-terminal-border/20 py-2">
                    <div className="text-[10px]">
                      <div className="font-bold text-terminal-accent uppercase">{sw.scope}</div>
                      <div className={sw.enabled ? "text-terminal-neg" : "text-terminal-pos"}>
                        {sw.enabled ? "INACTIVE (HALTED)" : "OPERATIONAL"}
                      </div>
                      <div className="text-[9px] text-terminal-muted italic">{sw.reason}</div>
                    </div>
                    <button
                      className={`rounded px-2 py-1 text-[9px] font-bold border transition-colors ${
                        sw.enabled
                          ? "bg-terminal-pos/10 border-terminal-pos text-terminal-pos hover:bg-terminal-pos/20"
                          : "bg-terminal-neg/10 border-terminal-neg text-terminal-neg hover:bg-terminal-neg/20"
                      }`}
                      onClick={async () => {
                        await setKillSwitch({
                          scope: sw.scope,
                          enabled: !sw.enabled,
                          reason: !sw.enabled ? "Manual emergency stop" : "Resumed"
                        });
                        setMessage(`${sw.scope} -> ${!sw.enabled ? "enabled" : "disabled"}`);
                        await load();
                      }}
                    >
                      {sw.enabled ? "RESUME" : "HALT"}
                    </button>
                  </div>
                ))}
              </div>
            </TerminalPanel>
          </div>
        )}
      </div>
    </div>
  );
}
