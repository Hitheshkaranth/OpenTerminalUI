import { NavLink } from "react-router-dom";

const tabs = [
  { label: "Watchlist", path: "/equity/watchlist" },
  { label: "Charts", path: "/equity/stocks" },
  { label: "Portfolio", path: "/equity/portfolio" },
  { label: "Alerts", path: "/equity/alerts" },
  { label: "More", path: "/equity/settings" },
];

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-terminal-border bg-terminal-panel px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 md:hidden">
      <div className="grid grid-cols-5 gap-1 text-[11px]">
        {tabs.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex min-h-11 items-center justify-center rounded border px-1 py-2 ${isActive ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
