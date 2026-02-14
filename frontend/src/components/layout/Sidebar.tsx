import { NavLink } from "react-router-dom";
import { useStockStore } from "../../store/stockStore";

export function Sidebar() {
  const ticker = useStockStore((s) => s.ticker);
  const nav = [
    { label: "Market", path: "/equity/stocks", key: "F1" },
    { label: "Screener", path: "/equity/screener", key: "F2" },
    { label: "Portfolio", path: "/equity/portfolio", key: "F3" },
    { label: "Watchlist", path: "/equity/watchlist", key: "F4" },
    { label: "News", path: "/equity/news", key: "F5" },
    { label: "Settings", path: "/equity/settings", key: "F6" },
    { label: "About", path: "/equity/stocks/about", key: "F7" },
  ];

  return (
    <aside className="relative z-30 w-48 shrink-0 border-r border-terminal-border bg-terminal-panel p-0">
      <div className="border-b border-terminal-border bg-terminal-accent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-black">
        OpenTerminalUI
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
          Switch To F&O →
        </NavLink>
      </div>
      <nav className="space-y-1 p-2 text-xs">
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
            <span>{item.label}</span>
            <span className="text-[10px]">{item.key}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
