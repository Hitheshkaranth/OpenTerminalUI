import { NavLink } from "react-router-dom";
import { Home, List, LineChart, Search, Briefcase } from "lucide-react";

const tabs = [
  { label: "Home", path: "/home", icon: Home, ariaLabel: "Go to Home" },
  { label: "Watch", path: "/equity/watchlist", icon: List, ariaLabel: "Go to Watchlist" },
  { label: "Chart", path: "/equity/chart-workstation", icon: LineChart, ariaLabel: "Go to Chart Workstation" },
  { label: "Scan", path: "/equity/screener", icon: Search, ariaLabel: "Go to Screener" },
  { label: "Port", path: "/equity/portfolio", icon: Briefcase, ariaLabel: "Go to Portfolio" },
];

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-terminal-border bg-terminal-panel px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 md:hidden" aria-label="Mobile navigation">
      <div className="grid grid-cols-5 gap-1 text-[10px]">
        {tabs.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            aria-label={item.ariaLabel}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 rounded border py-1.5 ${isActive ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`
            }
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
