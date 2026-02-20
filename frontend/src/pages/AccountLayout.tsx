import { Outlet } from "react-router-dom";

import { ErrorBoundary } from "../components/common/ErrorBoundary";
import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { TopBar } from "../components/layout/TopBar";
import { MobileBottomNav } from "../components/layout/MobileBottomNav";
import { InstallPromptBanner } from "../components/layout/InstallPromptBanner";

export function AccountLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg text-terminal-text">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar hideTickerLoader />
        <ErrorBoundary>
          <div className="relative z-0 min-h-0 flex-1 overflow-auto pb-16 md:pb-0">
            <Outlet />
          </div>
        </ErrorBoundary>
        <StatusBar tickerOverride="ACCOUNT" />
      </div>
      <InstallPromptBanner />
      <MobileBottomNav />
    </div>
  );
}
