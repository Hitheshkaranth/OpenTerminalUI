import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Compass, History, Pin, PinOff } from "lucide-react";

import { useNavigationStore, type NavEvent } from "../../store/navigationStore";
import { MAX_PINNED_TOOLS, useQuickAccessStore } from "../../store/quickAccessStore";
import { NAV_SECTIONS, findNavItem, type NavItem } from "./navConfig";

const tools = NAV_SECTIONS.flatMap((section) => section.items);

export function recentQuickAccessTools(history: NavEvent[], pinnedIds: string[], currentId?: string): NavItem[] {
  const seen = new Set([...pinnedIds, currentId, "workflows"]);
  const recent: NavItem[] = [];
  for (let index = history.length - 1; index >= 0 && recent.length < 3; index -= 1) {
    const path = history[index].path;
    // Only registered internal tool destinations are rendered. History is persisted
    // by a separate store and must not become an external or executable link.
    if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) continue;
    const pathname = path.split(/[?#]/, 1)[0];
    const item = tools.find((tool) => tool.to === pathname);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    recent.push(item);
  }
  return recent;
}

export function QuickAccessBar() {
  const { pathname } = useLocation();
  const current = findNavItem(pathname)?.item;
  const pinnedIds = useQuickAccessStore((state) => state.pinnedIds);
  const togglePin = useQuickAccessStore((state) => state.togglePin);
  const history = useNavigationStore((state) => state.history);
  const pinned = useMemo(() => pinnedIds.flatMap((id) => {
    const item = tools.find((tool) => tool.id === id);
    return item && item.id !== "workflows" ? [item] : [];
  }), [pinnedIds]);
  const recent = useMemo(() => recentQuickAccessTools(history, pinnedIds, current?.id), [history, pinnedIds, current?.id]);
  const isPinned = Boolean(current && pinnedIds.includes(current.id));
  const atLimit = pinnedIds.length >= MAX_PINNED_TOOLS;
  const pinLabel = current ? `${isPinned ? "Unpin" : "Pin"} ${current.label}` : "Pin current tool";
  const linkClass = "inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs hover:bg-terminal-accent/10 hover:text-terminal-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-terminal-accent";

  return (
    <nav aria-label="Quick access" className="flex min-w-0 shrink-0 items-center gap-2 border-b border-terminal-border bg-terminal-panel px-2 py-1 text-terminal-muted">
      <Link to="/equity/workflows" aria-current={pathname === "/equity/workflows" ? "page" : undefined} className={`${linkClass} text-terminal-accent`}>
        <Compass size={14} aria-hidden="true" /> Workflows
      </Link>
      <span aria-hidden="true" className="h-4 shrink-0 border-l border-terminal-border" />
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Pinned and recent tools">
        {pinned.length ? <Pin size={12} aria-label="Pinned tools" className="mx-1 shrink-0" /> : null}
        {pinned.map((item) => (
          <Link key={item.id} to={item.to} aria-current={current?.id === item.id ? "page" : undefined} className={`${linkClass} ${current?.id === item.id ? "bg-terminal-accent/10 text-terminal-accent" : ""}`}>
            {item.label}
          </Link>
        ))}
        {recent.length ? <History size={12} aria-label="Recent tools" className="ml-3 mr-1 shrink-0" /> : null}
        {recent.map((item) => <Link key={item.id} to={item.to} className={linkClass} title={`Recently visited: ${item.label}`}>{item.label}</Link>)}
        {!pinned.length && !recent.length ? <span className="whitespace-nowrap px-2 text-xs">Pin the tools you use most.</span> : null}
      </div>
      {current ? (
        <button type="button" aria-label={pinLabel} aria-pressed={isPinned} title={!isPinned && atLimit ? `Unpin a tool first (${MAX_PINNED_TOOLS} maximum)` : pinLabel} disabled={!isPinned && atLimit} onClick={() => togglePin(current.id)} className={`${linkClass} border border-terminal-border disabled:cursor-not-allowed disabled:opacity-50 ${isPinned ? "text-terminal-accent" : ""}`}>
          {isPinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
          <span className="hidden lg:inline">{isPinned ? "Unpin tool" : "Pin tool"}</span>
        </button>
      ) : null}
    </nav>
  );
}
