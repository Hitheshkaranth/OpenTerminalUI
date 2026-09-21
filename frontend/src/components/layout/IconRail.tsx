import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronDown, Star, StarOff } from "lucide-react";

import { AuthContextRef } from "../../contexts/AuthContext";
import { NAV_SECTIONS, PINNED_DEFAULT, findNavItem, type NavItem, type NavSection } from "./navConfig";
import { useNavigationStore } from "../../store/navigationStore";

const BRAND_ICON_SRC = "/favicon.png";

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or private browsing */
  }
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function IconRail() {
  const navigate = useNavigate();
  const authCtx = useContext(AuthContextRef);
  const user = authCtx?.user ?? null;
  const location = useLocation();
  const { pathname } = location;

  /* ---- expanded state ---- */
  const [expanded, setExpanded] = useState(() => {
    const stored = safeLocalStorageGet("ot:nav:expanded");
    if (stored === "true") return true;
    if (stored === "false") return false;
    return false;
  });

  useEffect(() => {
    safeLocalStorageSet("ot:nav:expanded", expanded ? "true" : "false");
  }, [expanded]);

  /* ---- section open state ---- */
  const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>(() => {
    const stored = safeLocalStorageGet("ot:nav:open");
    return safeJsonParse<Record<string, boolean>>(stored, {});
  });

  useEffect(() => {
    safeLocalStorageSet("ot:nav:open", JSON.stringify(sectionsOpen));
  }, [sectionsOpen]);

  /* ---- pinned state ---- */
  const [pinned, setPinned] = useState<string[]>(() => {
    const stored = safeLocalStorageGet("ot:nav:pinned");
    const parsed = safeJsonParse<string[]>(stored, []);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return [...PINNED_DEFAULT];
  });

  useEffect(() => {
    safeLocalStorageSet("ot:nav:pinned", JSON.stringify(pinned));
  }, [pinned]);

  /* ---- recent items ---- */
  const navHistory = useNavigationStore((s) => s.history);
  const recentNavItems = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ section: NavSection; item: NavItem }> = [];
    for (const entry of [...navHistory].reverse()) {
      const found = findNavItem(entry.path);
      if (!found || seen.has(found.item.id)) continue;
      seen.add(found.item.id);
      out.push(found);
      if (out.length >= 5) break;
    }
    return out;
  }, [navHistory]);

  /* ---- current section (for default open) ---- */
  const currentSectionId = useMemo(() => {
    const result = findNavItem(pathname);
    return result?.section?.id ?? null;
  }, [pathname]);

  /* ---- initial open state: open the section of the current route ---- */
  useEffect(() => {
    setSectionsOpen((prev) => {
      if (currentSectionId && !prev[currentSectionId]) {
        return { ...prev, [currentSectionId]: true };
      }
      return prev;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- initials ---- */
  const initials = useMemo(() => {
    if (!user?.email) return "U";
    const local = user.email.split("@")[0] || "";
    const bits = local.split(/[._-]+/).filter(Boolean);
    if (bits.length >= 2) return `${bits[0][0] || ""}${bits[1][0] || ""}`.toUpperCase();
    return (local.slice(0, 2) || "U").toUpperCase();
  }, [user?.email]);

  /* ---- helpers ---- */
  const toggleSection = (sectionId: string) => {
    setSectionsOpen((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const handlePinToggle = (itemId: string) => {
    setPinned((prev) => {
      if (prev.includes(itemId)) {
        return prev.filter((id) => id !== itemId);
      }
      return [...prev, itemId];
    });
  };

  const isPinned = (itemId: string) => pinned.includes(itemId);

  /* ---- keyboard nav ---- */
  const railRef = useRef<HTMLElement>(null);

  const onRailKeyDown = (event: React.KeyboardEvent) => {
    // Query live: the visible links change with expand/collapse, pins and section toggles.
    const links = Array.from(railRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-nav-idx]") ?? []);
    if (links.length === 0) return;

    // Find current active link element
    let currentIdx = links.findIndex((el) => el === document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      currentIdx = currentIdx >= 0 ? currentIdx + 1 : 0;
      currentIdx = Math.min(currentIdx, links.length - 1);
      links[currentIdx]?.focus();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      currentIdx = currentIdx >= 0 ? currentIdx - 1 : links.length - 1;
      currentIdx = Math.max(currentIdx, 0);
      links[currentIdx]?.focus();
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      links[0]?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      links[links.length - 1]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (currentIdx >= 0 && currentIdx < links.length) {
        const link = links[currentIdx];
        const href = link?.getAttribute("href");
        if (href) {
          navigate(href);
        }
      }
    }
  };

  /* ============ RENDER ============ */

  /* collapsed: only pinned items + "More" button */
  if (!expanded) {
    return (
      <aside
        ref={railRef}
        className="hidden h-full w-16 shrink-0 border-r border-terminal-border bg-terminal-panel md:flex md:flex-col"
        aria-label="Primary icon rail"
        onKeyDown={onRailKeyDown}
      >
        <div className="flex items-center justify-center border-b border-terminal-border px-2 py-2">
          <img src={BRAND_ICON_SRC} alt="OpenTerminalUI" className="h-7 w-7 max-w-full object-contain" />
        </div>
        <nav className="flex-1 space-y-1 overflow-auto p-2">
          {NAV_SECTIONS.flatMap((s) => s.items)
            .filter((item) => pinned.includes(item.id))
            .map((item) => (
              <NavLink
                key={item.id}
                data-nav-idx=""
                to={item.to}
                aria-label={item.label}
                className={({ isActive: active }) =>
                  [
                    "flex flex-col items-center gap-1 rounded-sm border px-1.5 py-2 text-center outline-none",
                    "focus-visible:border-terminal-accent focus-visible:text-terminal-accent",
                    active
                      ? "border-terminal-accent/80 bg-terminal-accent/15 text-terminal-accent"
                      : "border-transparent text-terminal-muted hover:border-terminal-border hover:text-terminal-text",
                  ].join(" ")
                }
              >
                <span className="ot-type-label text-[9px] leading-none">{item.glyph}</span>
                <span className="text-[9px] leading-tight">{item.label}</span>
              </NavLink>
            ))}
          <button
            type="button"
            aria-label="Expand navigation"
            onClick={() => setExpanded(true)}
            className="flex w-full flex-col items-center gap-1 rounded-sm border border-transparent px-1.5 py-2 text-center outline-none transition-colors focus-visible:border-terminal-accent focus-visible:text-terminal-accent text-terminal-muted hover:border-terminal-border hover:text-terminal-text"
          >
            <span className="ot-type-label text-[9px] leading-none">…</span>
            <span className="text-[9px] leading-tight">More</span>
          </button>
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

  /* expanded: grouped sections + pinned + recent */
  return (
    <aside
      ref={railRef}
      className="hidden h-full w-[208px] shrink-0 border-r border-terminal-border bg-terminal-panel md:flex md:flex-col"
      aria-label="Primary icon rail"
      onKeyDown={onRailKeyDown}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-terminal-border px-2 py-2">
        <img src={BRAND_ICON_SRC} alt="OpenTerminalUI" className="h-7 w-7 max-w-full object-contain" />
        <button
          type="button"
          aria-label="Collapse navigation"
          onClick={() => setExpanded(false)}
          className="rounded-sm p-1 text-terminal-muted hover:text-terminal-text"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* nav items */}
      <nav className="flex-1 overflow-auto p-2" tabIndex={-1}>
        {/* Recent group */}
        {expanded && recentNavItems.length > 0 && (
          <div className="mb-2">
            <div className="mb-1 px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-muted">
              Recent
            </div>
            <div className="space-y-0.5">
              {recentNavItems.map((ri, i) => (
                <NavLink
                  key={`recent-${ri.item.id}-${i}`}
                data-nav-idx=""
                  to={ri.item.to}
                  aria-label={ri.item.label}
                  className={({ isActive: active }) =>
                    [
                      "flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-left outline-none",
                      "focus-visible:border-terminal-accent focus-visible:text-terminal-accent",
                      active
                        ? "border border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
                        : "border-transparent text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text",
                    ].join(" ")
                  }
                >
                  <span className="inline-block w-8 shrink-0 text-center text-[10px] font-mono text-terminal-accent/70">
                    {ri.item.glyph}
                  </span>
                  <span className="truncate text-[11px]">{ri.item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}

        {/* Pinned section */}
        <div className="mb-2">
          <div className="mb-1 px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-terminal-muted">
            Pinned
          </div>
          <div className="space-y-0.5">
            {NAV_SECTIONS.flatMap((s) => s.items)
              .filter((item) => pinned.includes(item.id))
              .map((item) => {
                return (
                  <div key={item.id} className="flex items-center">
                    <NavLink
                data-nav-idx=""
                      to={item.to}
                      aria-label={item.label}
                      className={({ isActive: active }) =>
                        [
                          "flex flex-1 items-center gap-2 rounded-sm px-1.5 py-1.5 text-left outline-none",
                          "focus-visible:border-terminal-accent focus-visible:text-terminal-accent",
                          active
                            ? "border border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
                            : "border-transparent text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text",
                        ].join(" ")
                      }
                    >
                      <span className="inline-block w-8 shrink-0 text-center text-[10px] font-mono text-terminal-accent/70">
                        {item.glyph}
                      </span>
                      <span className="truncate text-[11px]">{item.label}</span>
                    </NavLink>
                    <button
                      type="button"
                      aria-label={isPinned(item.id) ? "Unpin" : "Pin"}
                      onClick={() => handlePinToggle(item.id)}
                      className="ml-auto p-1 text-terminal-muted hover:text-terminal-accent"
                    >
                      {isPinned(item.id) ? (
                        <Star className="h-3 w-3 fill-terminal-accent text-terminal-accent" />
                      ) : (
                        <StarOff className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Sections */}
        {NAV_SECTIONS.map((section) => {
          const isOpen = sectionsOpen[section.id] ?? (section.id === currentSectionId);
          return (
            <div key={section.id} className="mb-2">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center gap-1 px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-terminal-muted hover:text-terminal-text"
              >
                {isOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>{section.label}</span>
              </button>
              {isOpen && (
                <div className="mt-0.5 space-y-0.5 pl-1">
                  {section.items.map((item) => {
                    return (
                      <div key={item.id} className="flex items-center">
                        <NavLink
                data-nav-idx=""
                          to={item.to}
                          aria-label={item.label}
                          className={({ isActive: active }) =>
                            [
                              "flex flex-1 items-center gap-2 rounded-sm px-1.5 py-1.5 text-left outline-none",
                              "focus-visible:border-terminal-accent focus-visible:text-terminal-accent",
                              active
                                ? "border border-terminal-accent/60 bg-terminal-accent/15 text-terminal-accent"
                                : "border-transparent text-terminal-muted hover:bg-terminal-bg hover:text-terminal-text",
                            ].join(" ")
                          }
                        >
                          <span className="inline-block w-8 shrink-0 text-center text-[10px] font-mono text-terminal-accent/70">
                            {item.glyph}
                          </span>
                          <span className="truncate text-[11px]">{item.label}</span>
                          {item.hotkey && (
                            <span className="ml-auto rounded border border-terminal-border px-1 py-px text-[9px] text-terminal-muted">
                              {item.hotkey}
                            </span>
                          )}
                        </NavLink>
                        <button
                          type="button"
                          aria-label={isPinned(item.id) ? "Unpin" : "Pin"}
                          onClick={() => handlePinToggle(item.id)}
                          className="ml-auto p-1 text-terminal-muted hover:text-terminal-accent"
                        >
                          {isPinned(item.id) ? (
                            <Star className="h-3 w-3 fill-terminal-accent text-terminal-accent" />
                          ) : (
                            <StarOff className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* footer */}
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