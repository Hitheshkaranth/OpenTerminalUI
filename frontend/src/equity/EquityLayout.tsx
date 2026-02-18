import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { TopBar } from "../components/layout/TopBar";
import { MobileBottomNav } from "../components/layout/MobileBottomNav";
import { InstallPromptBanner } from "../components/layout/InstallPromptBanner";
import { useStockStore } from "../store/stockStore";

export function EquityLayout() {
  const setTicker = useStockStore((s) => s.setTicker);
  const location = useLocation();

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const t = (p.get("ticker") || p.get("symbol") || "").trim().toUpperCase();
    if (t) {
      setTicker(t);
    }
  }, [location.search, setTicker]);

  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg text-terminal-text">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ErrorBoundary>
          <div className="relative z-0 min-h-0 flex-1 overflow-auto pb-16 md:pb-0">
            <Outlet />
          </div>
        </ErrorBoundary>
        <StatusBar />
      </div>
      <InstallPromptBanner />
      <MobileBottomNav />
    </div>
  );
}
