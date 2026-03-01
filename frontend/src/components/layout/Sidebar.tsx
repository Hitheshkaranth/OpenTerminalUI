import { NavLink } from "react-router-dom";
import { useStockStore } from "../../store/stockStore";
import logo from "../../assets/logo.png";
import { useAlertsStore } from "../../store/alertsStore";
import { UserAccountPanel } from "./UserAccountPanel";

export function Sidebar() {
  const ticker = useStockStore((s) => s.ticker);
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  const nav = [
    { label: "Market", path: "/equity/stocks", key: "F1" },
    { label: "Security Hub", path: "/equity/security", key: "SH", hint: "Research" },
    { label: "Economics", path: "/equity/economics", key: "E", hint: "Macro" },
    { label: "Yield Curve", path: "/equity/yield-curve", key: "YC", hint: "Fixed Income" },
    { label: "Rotation", path: "/equity/sector-rotation", key: "ROT", hint: "Relative" },
    { label: "Crypto", path: "/equity/crypto", key: "CR", hint: "Digital" },
    { label: "Compare", path: "/equity/compare", key: "CMP", hint: "Split View" },
    { label: "Screener", path: "/equity/screener", key: "F2" },
    { label: "Launchpad", path: "/equity/launchpad", key: "LP", hint: "Workspace" },
    { label: "Workstation", path: "/equity/chart-workstation", key: "6", hint: "6 Charts" },
    { label: "Portfolio", path: "/equity/portfolio", key: "F3" },
    { label: "Portfolio Lab", path: "/equity/portfolio/lab", key: "PLB", hint: "Research" },
    { label: "Paper", path: "/equity/paper", key: "P" },
    { label: "Watchlist", path: "/equity/watchlist", key: "F4" },
    { label: "News", path: "/equity/news", key: "F5" },
    { label: "Alerts", path: "/equity/alerts", key: "A" },
    { label: "Risk", path: "/equity/risk", key: "R" },
    { label: "OMS", path: "/equity/oms", key: "O" },
    { label: "Ops", path: "/equity/ops", key: "K" },
    { label: "Plugins", path: "/equity/plugins", key: "PL" },
    { label: "Settings", path: "/equity/settings", key: "F6" },
    { label: "About", path: "/equity/stocks/about", key: "F7" },
    { label: "Model Lab", path: "/backtesting/model-lab", key: "ML", hint: "Backtest" },
    { label: "Cockpit", path: "/equity/cockpit", key: "CP", hint: "Overview" },
    { label: "Backtesting", path: "/backtesting", key: "F9" },
  ];

  return (
    <aside className="relative z-30 flex h-full w-48 shrink-0 flex-col border-r border-terminal-border bg-terminal-panel p-0">
      <div className="border-b border-terminal-border bg-terminal-panel px-3 py-2">
        <img src={logo} alt="OpenTerminalUI" className="h-8 w-auto object-contain" />
      </div>
      <div className="border-b border-terminal-border px-3 py-2 text-[11px] text-terminal-muted">
        NSE EQUITY ANALYTICS
      </div>
      <div className="space-y-1 border-b border-terminal-border p-2 text-xs">
        <NavLink to="/" className="block rounded px-2 py-2 text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text">
          Home
        </NavLink>
        <NavLink
          to={`/fno?symbol=${encodeURIComponent((ticker || "NIFTY").toUpperCase())}`}
          className="block rounded px-2 py-2 text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
        >
          Switch To F&O {"->"}
        </NavLink>
      </div>
      <nav className="flex-1 space-y-1 overflow-auto p-2 text-xs">
        {nav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex cursor-pointer items-center justify-between rounded px-2 py-2 ${
                isActive
                  ? "bg-terminal-accent/20 text-terminal-accent"
                  : "text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text"
              }`
            }
          >
            <div className="flex flex-col">
              <span>{item.label}</span>
              {(item as any).hint && <span className="text-[8px] text-terminal-accent/70 -mt-0.5 uppercase">{(item as any).hint}</span>}
            </div>
            <span className="text-[10px]">
              {item.path === "/equity/alerts" && unreadCount > 0 ? `${unreadCount}` : item.key}
            </span>
          </NavLink>
        ))}
      </nav>
      <UserAccountPanel />
    </aside>
  );
}
