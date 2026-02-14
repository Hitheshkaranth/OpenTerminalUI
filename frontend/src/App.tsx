import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardPage } from "./pages/Dashboard";
import { AboutPage } from "./pages/About";
import { PortfolioPage } from "./pages/Portfolio";
import { ScreenerPage } from "./pages/Screener";
import { SettingsPage } from "./pages/Settings";
import { StockDetailPage } from "./pages/StockDetail";
import { WatchlistPage } from "./pages/Watchlist";
import { NewsPage } from "./pages/News";
import { EquityLayout } from "./equity/EquityLayout";
import { HomePage } from "./home/HomePage";
import { FnoLayout } from "./fno/FnoLayout";
import { OptionChainPage } from "./fno/pages/OptionChainPage";
import { GreeksPage } from "./fno/pages/GreeksPage";
import { FuturesPage } from "./fno/pages/FuturesPage";
import { OIAnalysisPage } from "./fno/pages/OIAnalysisPage";
import { StrategyPage } from "./fno/pages/StrategyPage";
import { PCRPage } from "./fno/pages/PCRPage";
import { HeatmapPage } from "./fno/pages/HeatmapPage";
import { ExpiryPage } from "./fno/pages/ExpiryPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route path="/equity" element={<EquityLayout />}>
        <Route index element={<Navigate to="/equity/stocks" replace />} />
        <Route path="stocks" element={<StockDetailPage />} />
        <Route path="stocks/about" element={<AboutPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="screener" element={<ScreenerPage />} />
        <Route path="portfolio" element={<PortfolioPage />} />
        <Route path="watchlist" element={<WatchlistPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/fno" element={<FnoLayout />}>
        <Route index element={<OptionChainPage />} />
        <Route path="greeks" element={<GreeksPage />} />
        <Route path="futures" element={<FuturesPage />} />
        <Route path="oi" element={<OIAnalysisPage />} />
        <Route path="strategy" element={<StrategyPage />} />
        <Route path="pcr" element={<PCRPage />} />
        <Route path="heatmap" element={<HeatmapPage />} />
        <Route path="expiry" element={<ExpiryPage />} />
      </Route>

      <Route path="/stocks" element={<Navigate to="/equity/stocks" replace />} />
      <Route path="/stocks/about" element={<Navigate to="/equity/stocks/about" replace />} />
      <Route path="/dashboard" element={<Navigate to="/equity/dashboard" replace />} />
      <Route path="/screener" element={<Navigate to="/equity/screener" replace />} />
      <Route path="/portfolio" element={<Navigate to="/equity/portfolio" replace />} />
      <Route path="/watchlist" element={<Navigate to="/equity/watchlist" replace />} />
      <Route path="/news" element={<Navigate to="/equity/news" replace />} />
      <Route path="/settings" element={<Navigate to="/equity/settings" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
