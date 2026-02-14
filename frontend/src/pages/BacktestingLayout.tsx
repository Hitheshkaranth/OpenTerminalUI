import { Outlet } from "react-router-dom";

import { Sidebar } from "../components/layout/Sidebar";
import { StatusBar } from "../components/layout/StatusBar";
import { TopBar } from "../components/layout/TopBar";
import { ErrorBoundary } from "../components/common/ErrorBoundary";

export function BacktestingLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg text-terminal-text">
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ErrorBoundary>
          <div className="relative z-0 min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </ErrorBoundary>
        <StatusBar />
      </div>
    </div>
  );
}
