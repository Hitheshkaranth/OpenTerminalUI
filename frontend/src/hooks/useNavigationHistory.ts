import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useNavigationStore, type NavEvent } from "../store/navigationStore";

export type NavigationBreadcrumb = {
  label: string;
  path: string;
};

type UseNavigationHistoryOptions = {
  autoTrack?: boolean;
};

const ROOT_CRUMBS: Record<string, NavigationBreadcrumb> = {
  equity: { label: "Equity", path: "/equity/stocks" },
  fno: { label: "F&O", path: "/fno" },
  backtesting: { label: "Backtesting", path: "/backtesting" },
  account: { label: "Account", path: "/account" },
};

const SEGMENT_LABELS: Record<string, string> = {
  stocks: "Stocks",
  screener: "Screener",
  security: "Security Hub",
  portfolio: "Portfolio",
  watchlist: "Watchlist",
  news: "News",
  alerts: "Alerts",
  "chart-workstation": "Chart Workstation",
  launchpad: "Launchpad",
  compare: "Compare",
  economics: "Economics",
  crypto: "Crypto Workspace",
  "yield-curve": "Yield Curve",
  settings: "Settings",
  ops: "Ops",
  risk: "Risk",
  hotlists: "Hotlists",
  etf: "ETF Analytics",
  bonds: "Bonds",
  tca: "TCA",
  community: "Community",
};

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function buildSecurityCrumbs(pathname: string, search: string): NavigationBreadcrumb[] {
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean);
  const symbol = (parts[2] || params.get("ticker") || "Security").toUpperCase();
  const tab = params.get("tab");
  const subtab = params.get("subtab");
  const crumbs: NavigationBreadcrumb[] = [
    { label: "Home", path: "/" },
    ROOT_CRUMBS.equity,
    { label: symbol, path: `/equity/security/${symbol}` },
  ];

  if (tab && tab.toLowerCase() !== "overview") {
    crumbs.push({
      label: titleCase(tab),
      path: `/equity/security/${symbol}?tab=${encodeURIComponent(tab)}`,
    });
  }
  if (subtab) {
    crumbs.push({
      label: titleCase(subtab),
      path: `/equity/security/${symbol}?tab=${encodeURIComponent(tab || "financials")}&subtab=${encodeURIComponent(subtab)}`,
    });
  }

  return crumbs;
}

function buildGenericCrumbs(pathname: string, search: string): NavigationBreadcrumb[] {
  const params = new URLSearchParams(search);
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: NavigationBreadcrumb[] = [{ label: "Home", path: "/" }];

  if (!parts.length) {
    return crumbs;
  }

  const root = ROOT_CRUMBS[parts[0]];
  if (root) {
    crumbs.push(root);
  }

  let currentPath = "";
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    currentPath += `/${part}`;

    if (index === 0) {
      continue;
    }

    if (parts[0] === "equity" && part === "security") {
      continue;
    }

    const queryTicker = params.get("ticker");
    if ((part === "stocks" || part === "chart-workstation") && queryTicker) {
      crumbs.push({
        label: queryTicker.toUpperCase(),
        path: `${currentPath}?ticker=${encodeURIComponent(queryTicker)}`,
      });
      crumbs.push({
        label: SEGMENT_LABELS[part] || titleCase(part),
        path: `${currentPath}?ticker=${encodeURIComponent(queryTicker)}`,
      });
      continue;
    }

    const label = SEGMENT_LABELS[part] || (/^[A-Z0-9.\-]{1,20}$/i.test(part) ? part.toUpperCase() : titleCase(part));
    crumbs.push({ label, path: currentPath });
  }

  const view = params.get("view");
  if (view) {
    crumbs.push({
      label: titleCase(view),
      path: `${pathname}?view=${encodeURIComponent(view)}`,
    });
  }

  return crumbs;
}

function buildNavigationSnapshot(pathname: string, search: string): { breadcrumbs: NavigationBreadcrumb[]; event: NavEvent } {
  const breadcrumbs =
    pathname.startsWith("/equity/security")
      ? buildSecurityCrumbs(pathname, search)
      : buildGenericCrumbs(pathname, search);
  const label = breadcrumbs.slice(1).map((crumb) => crumb.label).join(" - ") || "Home";

  return {
    breadcrumbs,
    event: {
      path: `${pathname}${search || ""}`,
      label,
      breadcrumbs: breadcrumbs.map((crumb) => crumb.label),
      timestamp: Date.now(),
    },
  };
}

export function useNavigationHistory(options: UseNavigationHistoryOptions = {}) {
  const { autoTrack = false } = options;
  const location = useLocation();
  const navigate = useNavigate();
  const push = useNavigationStore((state) => state.push);
  const goBackStore = useNavigationStore((state) => state.goBack);
  const goForwardStore = useNavigationStore((state) => state.goForward);
  const history = useNavigationStore((state) => state.history);
  const currentIndex = useNavigationStore((state) => state.currentIndex);
  const snapshot = useMemo(
    () => buildNavigationSnapshot(location.pathname, location.search),
    [location.pathname, location.search],
  );

  useEffect(() => {
    if (!autoTrack) return;
    push(snapshot.event);
  }, [autoTrack, push, snapshot.event]);

  const goBack = useCallback(() => {
    const previous = goBackStore();
    if (previous) {
      navigate(previous.path);
    }
    return previous;
  }, [goBackStore, navigate]);

  const goForward = useCallback(() => {
    const next = goForwardStore();
    if (next) {
      navigate(next.path);
    }
    return next;
  }, [goForwardStore, navigate]);

  useEffect(() => {
    if (!autoTrack) return;

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        Boolean(target?.isContentEditable) ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if (isEditable) return;

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }

      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        goForward();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [autoTrack, goBack, goForward]);

  const recentPages = useMemo(() => {
    const seen = new Set<string>();
    const recent: NavEvent[] = [];
    for (let index = history.length - 1; index >= 0 && recent.length < 10; index -= 1) {
      const event = history[index];
      if (seen.has(event.path)) continue;
      seen.add(event.path);
      recent.push(event);
    }
    return recent;
  }, [history]);

  return {
    breadcrumbs: snapshot.breadcrumbs,
    recentPages,
    currentIndex,
    goBack,
    goForward,
  };
}
