import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { X } from "lucide-react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

const navItems: Array<{ label: string; path: string; exact?: boolean }> = [
  { label: "Home", path: "/home", exact: true },
  { label: "Watchlist", path: "/equity/watchlist" },
  { label: "Chart Workstation", path: "/equity/chart-workstation" },
  { label: "Screener", path: "/equity/screener" },
  { label: "Portfolio", path: "/equity/portfolio" },
  { label: "Paper Trading", path: "/equity/paper" },
  { label: "Alerts", path: "/alerts" },
  { label: "Risk Dashboard", path: "/equity/risk" },
  { label: "News", path: "/equity/news" },
];

export function MobileSidebar({ isOpen, onClose }: Props) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform border-r border-terminal-border bg-terminal-panel transition-transform duration-200 ease-in-out ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-terminal-border px-3 py-2">
          <span className="text-sm font-semibold text-terminal-accent">OpenTerminal</span>
          <button
            type="button"
            className="rounded-sm border border-terminal-border p-1 text-terminal-muted transition-colors hover:text-terminal-text"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <nav className="flex flex-col gap-0.5 p-2" aria-label="Mobile navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center rounded-sm border px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                    : "border-transparent text-terminal-muted hover:border-terminal-border hover:text-terminal-text"
                }`
              }
              onClick={onClose}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}