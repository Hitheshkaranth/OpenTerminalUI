import { Navigate, Route, Routes } from "react-router-dom";

import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { TopBar } from "./components/layout/TopBar";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { DashboardPage } from "./pages/Dashboard";
import { AboutPage } from "./pages/About";
import { PortfolioPage } from "./pages/Portfolio";
import { ScreenerPage } from "./pages/Screener";
import { SettingsPage } from "./pages/Settings";
import { StockDetailPage } from "./pages/StockDetail";
import { WatchlistPage } from "./pages/Watchlist";
import { NewsPage } from "./pages/News";

function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-terminal-bg text-terminal-text">
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ErrorBoundary>
          <div className="relative z-0 min-h-0 flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/stocks" replace />} />
              <Route path="/stocks" element={<StockDetailPage />} />
              <Route path="/stocks/about" element={<AboutPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/screener" element={<ScreenerPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/watchlist" element={<WatchlistPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </ErrorBoundary>
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
