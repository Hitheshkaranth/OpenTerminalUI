import { NavLink } from "react-router-dom";

export function Sidebar() {
  const nav = [
    { label: "Market", path: "/stocks", key: "F1" },
    { label: "Screener", path: "/screener", key: "F2" },
    { label: "Portfolio", path: "/portfolio", key: "F3" },
    { label: "Watchlist", path: "/watchlist", key: "F4" },
    { label: "Settings", path: "/settings", key: "F5" },
  ];

  return (
    <aside className="relative z-30 w-48 shrink-0 border-r border-terminal-border bg-terminal-panel p-0">
      <div className="border-b border-terminal-border bg-terminal-accent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-black">
        OpenTerminalUI
      </div>
      <div className="border-b border-terminal-border px-3 py-2 text-[11px] text-terminal-muted">
        NSE EQUITY ANALYTICS
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
