import { useId, useMemo } from "react";
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import {
  cycleLinkGroup,
  setPanelLinkGroup,
  usePanelLinkGroup,
  type LinkGroup,
} from "../../contexts/SymbolLinkContext";

type PanelFrameProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
  children: ReactNode;
};

export function PanelFrame({ as = "section", children, className = "", ...rest }: PanelFrameProps) {
  const Tag = as;
  return (
    <Tag
      {...rest}
      className={`rounded-sm border border-terminal-border bg-terminal-panel ${className}`.trim()}
    >
      {children}
    </Tag>
  );
}

type PanelHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  linkGroup?: LinkGroup;
  onLinkGroupChange?: (group: LinkGroup) => void;
  linkGroupId?: string;
  onPopout?: () => void;
};

const LAUNCHPAD_TYPE_BY_BADGE: Record<string, string> = {
  CH: "chart",
  WL: "watchlist",
  NW: "news-feed",
  OV: "overview",
  OB: "order-book",
  SC: "screener",
  FN: "financials",
  AL: "portfolio-allocation",
  PF: "portfolio-performance",
  RM: "risk-metrics",
  MP: "market-pulse",
  YC: "yield-curve",
  EC: "economics",
  GR: "greeks",
  OI: "oi-chart",
  PR: "peers",
  AI: "ai-research",
  OC: "option-chain",
  HM: "watchlist-heatmap",
  RRG: "sector-rotation",
  PN: "ticker-detail",
};

function getCurrentThemeVariant(): string | null {
  if (typeof document === "undefined") return null;
  return document.documentElement.getAttribute("data-ot-theme")?.trim() || null;
}

function getLaunchpadPanelPopoutUrl(panelRoot: HTMLElement, currentLinkGroup: LinkGroup): string | null {
  if (typeof window === "undefined") return null;

  const panelId = panelRoot.getAttribute("data-launchpad-panel-id")?.trim() || "";
  if (!panelId) return null;

  const header = panelRoot.querySelector("header");
  const titleInput = header?.querySelector<HTMLInputElement>('input[aria-label="Panel title"]');
  const symbolInput = header?.querySelector<HTMLInputElement>('input[aria-label="Panel symbol"]');
  const typeBadge = header?.querySelector<HTMLElement>('div.inline-flex.items-center.gap-2 span[class*="text-[10px]"]');
  const linkGroupButton = header?.querySelector<HTMLButtonElement>("button[data-link-group]");
  const themeVariant = getCurrentThemeVariant();

  const badgeCode = (typeBadge?.textContent ?? "").trim().toUpperCase();
  const panelType = LAUNCHPAD_TYPE_BY_BADGE[badgeCode];
  const panelTitle = titleInput?.value.trim() || typeBadge?.parentElement?.textContent?.trim() || "Launchpad Panel";
  const panelSymbol = symbolInput?.value.trim().toUpperCase() || "";
  const effectiveLinkGroup = linkGroupButton?.dataset.linkGroup?.trim() || currentLinkGroup;

  if (!panelType) return null;

  const url = new URL("/equity/launchpad/popout", window.location.origin);
  url.searchParams.set("id", panelId);
  url.searchParams.set("type", panelType);
  url.searchParams.set("title", panelTitle);
  if (panelSymbol) url.searchParams.set("symbol", panelSymbol);
  url.searchParams.set("linked", effectiveLinkGroup === "none" ? "0" : "1");
  if (effectiveLinkGroup !== "none") {
    url.searchParams.set("linkGroup", effectiveLinkGroup);
  }
  if (themeVariant) {
    url.searchParams.set("theme", themeVariant);
  }
  return url.toString();
}

function getGenericPopoutUrl(currentLinkGroup: LinkGroup): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const themeVariant = getCurrentThemeVariant();
  if (themeVariant) {
    url.searchParams.set("theme", themeVariant);
  }
  if (currentLinkGroup !== "none") {
    url.searchParams.set("linkGroup", currentLinkGroup);
  }
  return url.toString();
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  toolbar,
  linkGroup,
  onLinkGroupChange,
  linkGroupId,
  onPopout,
  className = "",
  ...rest
}: PanelHeaderProps) {
  if (!title && !subtitle && !actions && !toolbar) return null;

  const autoLinkGroupId = useId();
  const resolvedLinkGroupId = linkGroupId || autoLinkGroupId;
  const sharedLinkGroup = usePanelLinkGroup(resolvedLinkGroupId);
  const isControlled = typeof linkGroup !== "undefined";
  const currentLinkGroup = isControlled ? linkGroup : sharedLinkGroup;

  const indicatorClassName = useMemo(() => {
    switch (currentLinkGroup) {
      case "red":
        return "border-red-400 bg-red-500/90 shadow-[0_0_0_1px_rgba(248,113,113,0.45)]";
      case "blue":
        return "border-sky-400 bg-sky-500/90 shadow-[0_0_0_1px_rgba(56,189,248,0.45)]";
      case "green":
        return "border-emerald-400 bg-emerald-500/90 shadow-[0_0_0_1px_rgba(52,211,153,0.45)]";
      case "yellow":
        return "border-amber-300 bg-amber-400/90 shadow-[0_0_0_1px_rgba(251,191,36,0.45)]";
      default:
        return "border-terminal-border bg-transparent";
    }
  }, [currentLinkGroup]);

  const handleCycleLinkGroup = () => {
    const next = cycleLinkGroup(currentLinkGroup ?? "none");
    if (isControlled) {
      onLinkGroupChange?.(next);
      return;
    }
    setPanelLinkGroup(resolvedLinkGroupId, next);
  };

  const handlePopout = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (typeof window === "undefined") return;

    const panelRoot = event.currentTarget.closest<HTMLElement>("[data-launchpad-panel-id]");
    const launchpadUrl = panelRoot ? getLaunchpadPanelPopoutUrl(panelRoot, currentLinkGroup ?? "none") : null;
    const fallbackUrl = getGenericPopoutUrl(currentLinkGroup ?? "none");
    const targetUrl = launchpadUrl ?? fallbackUrl;
    if (!targetUrl) return;
    const popup = window.open(targetUrl, "_blank", "noopener,noreferrer,width=1280,height=760");
    if (popup) {
      onPopout?.();
    }
  };

  return (
    <header {...rest} className={`border-b border-terminal-border ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${indicatorClassName}`.trim()}
            onClick={handleCycleLinkGroup}
            aria-label={`Cycle panel link group. Current group: ${currentLinkGroup}.`}
            title={`Link group: ${currentLinkGroup}. Click to cycle.`}
            data-link-group={currentLinkGroup}
          >
            <span className="sr-only">{currentLinkGroup}</span>
          </button>
          <div className="min-w-0">
            {title ? <div className="ot-type-panel-title text-terminal-accent">{title}</div> : null}
            {subtitle ? <div className="ot-type-panel-subtitle truncate text-terminal-muted">{subtitle}</div> : null}
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-terminal-muted hover:text-terminal-text"
            onClick={handlePopout}
            title="Pop out to new window"
            aria-label="Pop out to new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>
      {toolbar ? <div className="border-t border-terminal-border/60 px-2 py-1">{toolbar}</div> : null}
    </header>
  );
}

type PanelBodyProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PanelBody({ children, className = "", ...rest }: PanelBodyProps) {
  return (
    <div {...rest} className={`p-2 ${className}`.trim()}>
      {children}
    </div>
  );
}

type PanelFooterProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

export function PanelFooter({ children, className = "", ...rest }: PanelFooterProps) {
  return (
    <footer {...rest} className={`border-t border-terminal-border px-2 py-1 ${className}`.trim()}>
      {children}
    </footer>
  );
}
