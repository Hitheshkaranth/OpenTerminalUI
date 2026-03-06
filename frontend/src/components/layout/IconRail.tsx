import { useContext, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AuthContextRef } from "../../contexts/AuthContext";

type RailItem = {
  id: string;
  label: string;
  glyph: string;
  to: string;
};

const RAIL_ITEMS: RailItem[] = [
  { id: "home", label: "Home", glyph: "HM", to: "/home" },
  { id: "market", label: "Market", glyph: "MK", to: "/equity/stocks" },
  { id: "workstation", label: "Workstation", glyph: "WS", to: "/equity/chart-workstation" },
  { id: "launchpad", label: "Launchpad", glyph: "LP", to: "/equity/launchpad" },
  { id: "screener", label: "Screener", glyph: "SC", to: "/equity/screener" },
  { id: "portfolio", label: "Portfolio", glyph: "PF", to: "/equity/portfolio" },
  { id: "watchlist", label: "Watchlist", glyph: "WL", to: "/equity/watchlist" },
  { id: "news", label: "News", glyph: "NW", to: "/equity/news" },
  { id: "alerts", label: "Alerts", glyph: "AL", to: "/equity/alerts" },
  { id: "settings", label: "Settings", glyph: "ST", to: "/equity/settings" },
];

export function IconRail() {
  const navigate = useNavigate();
  const authCtx = useContext(AuthContextRef);
  const user = authCtx?.user ?? null;
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const items = useMemo(() => RAIL_ITEMS, []);

  const initials = useMemo(() => {
    if (!user?.email) return "U";
    const local = user.email.split("@")[0] || "";
    const bits = local.split(/[._-]+/).filter(Boolean);
    if (bits.length >= 2) return `${bits[0][0] || ""}${bits[1][0] || ""}`.toUpperCase();
    return (local.slice(0, 2) || "U").toUpperCase();
  }, [user?.email]);

  const focusIndex = (index: number) => {
    if (!items.length) return;
    const bounded = ((index % items.length) + items.length) % items.length;
    linkRefs.current[bounded]?.focus();
  };

  const onRailKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const focusedIndex = linkRefs.current.findIndex((el) => el === document.activeElement);
    if (focusedIndex < 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusIndex(focusedIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusIndex(focusedIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusIndex(items.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = items[focusedIndex];
      if (item) {
        navigate(item.to);
      }
    }
  };

  return (
    <aside
      className="hidden h-full w-16 shrink-0 border-r border-terminal-border bg-terminal-panel md:flex md:flex-col"
      aria-label="Primary icon rail"
      onKeyDown={onRailKeyDown}
    >
      <div className="flex items-center justify-center border-b border-terminal-border px-2 py-2">
        <img src="/favicon.png" alt="OpenTerminalUI" className="h-8 w-8 object-contain" />
      </div>
      <nav className="flex-1 space-y-1 overflow-auto p-2">
        {items.map((item, index) => (
          <NavLink
            key={item.id}
            ref={(element) => {
              linkRefs.current[index] = element;
            }}
            to={item.to}
            aria-label={item.label}
            className={({ isActive }) =>
              [
                "flex flex-col items-center gap-1 rounded-sm border px-1.5 py-2 text-center outline-none",
                "focus-visible:border-terminal-accent focus-visible:text-terminal-accent",
                isActive
                  ? "border-terminal-accent/80 bg-terminal-accent/15 text-terminal-accent"
                  : "border-transparent text-terminal-muted hover:border-terminal-border hover:text-terminal-text",
              ].join(" ")
            }
          >
            <span className="ot-type-label text-[9px] leading-none">{item.glyph}</span>
            <span className="text-[9px] leading-tight">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-terminal-border p-2 space-y-2">
        <button
          type="button"
          className="w-full rounded-sm border border-terminal-border px-1 py-1 text-[9px] uppercase tracking-[0.08em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
            );
          }}
        >
          Cmd
        </button>
        <button
          type="button"
          className="flex w-full flex-col items-center gap-1 rounded-sm border border-transparent px-1 py-1.5 text-terminal-muted hover:border-terminal-border hover:text-terminal-text"
          onClick={() => navigate("/account")}
          title={user ? `${user.email} (${user.role})` : "Not signed in"}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-terminal-border text-[9px] font-medium text-terminal-accent">
            {user ? initials : "?"}
          </span>
          <span className="text-[8px] leading-tight truncate w-full text-center uppercase">
            {user ? user.role : "Sign in"}
          </span>
        </button>
      </div>
    </aside>
  );
}
