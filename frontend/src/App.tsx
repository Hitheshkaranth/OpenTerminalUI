import { Navigate, Route, Routes } from "react-router-dom";

import { DashboardPage } from "./pages/Dashboard";
import { AboutPage } from "./pages/About";
import { PortfolioPage } from "./pages/Portfolio";
import { ScreenerPage } from "./pages/Screener";
import { SettingsPage } from "./pages/Settings";
import { StockDetailPage } from "./pages/StockDetail";
import { WatchlistPage } from "./pages/Watchlist";
import { NewsPage } from "./pages/News";
import { BacktestingPage } from "./pages/Backtesting";
import { BacktestingLayout } from "./pages/BacktestingLayout";
import { EquityLayout } from "./equity/EquityLayout";
import { HomePage } from "./pages/HomePage";
import { FnoLayout } from "./fno/FnoLayout";
import { OptionChainPage } from "./fno/pages/OptionChainPage";
import { GreeksPage } from "./fno/pages/GreeksPage";
import { FuturesPage } from "./fno/pages/FuturesPage";
import { OIAnalysisPage } from "./fno/pages/OIAnalysisPage";
import { StrategyPage } from "./fno/pages/StrategyPage";
import { PCRPage } from "./fno/pages/PCRPage";
import { HeatmapPage } from "./fno/pages/HeatmapPage";
import { ExpiryPage } from "./fno/pages/ExpiryPage";
import { FnoAboutPage } from "./fno/pages/AboutPage";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/Auth/RegisterPage";
import { ForgotAccessPage } from "./pages/Auth/ForgotAccessPage";
import { AlertsPage } from "./pages/Alerts";
import { PaperTradingPage } from "./pages/PaperTrading";
import { PluginsPage } from "./pages/Plugins/Plugins";
import { TerminalBackground } from "./components/TerminalBackground";
import { ModelLabPage } from "./pages/ModelLab";
import { ModelLabExperimentDetailPage } from "./pages/ModelLabExperimentDetail";
import { ModelLabRunReportPage } from "./pages/ModelLabRunReport";
import { ModelLabComparePage } from "./pages/ModelLabCompare";
import { PortfolioLabPage } from "./pages/PortfolioLab";
import { PortfolioLabDetailPage } from "./pages/PortfolioLabDetail";
import { PortfolioLabRunReportPage } from "./pages/PortfolioLabRunReport";
import { PortfolioLabBlendsPage } from "./pages/PortfolioLabBlends";
import { AccountPage } from "./pages/Account";
import { AccountLayout } from "./pages/AccountLayout";
import { RiskDashboardPage } from "./pages/RiskDashboard";
import { OmsCompliancePage } from "./pages/OmsCompliance";
import { OpsDashboardPage } from "./pages/OpsDashboard";
import { ModelGovernancePage } from "./pages/ModelGovernance";
import CockpitDashboard from "./pages/Cockpit";
import { ChartWorkstationPage } from "./pages/ChartWorkstationPage";
import { LaunchpadPage } from "./pages/Launchpad";
import { SecurityHubPage } from "./pages/SecurityHub";
import { SplitComparisonPage } from "./pages/SplitComparison";
import { ThemeRuntime } from "./components/layout/ThemeRuntime";
import { LaunchpadPopoutPage } from "./pages/LaunchpadPopout";

function App() {
  return (
    <div className="ot-app-shell">
      <ThemeRuntime />
      <TerminalBackground />
      <div className="ot-vignette-overlay" />
      <div className="ot-scanline-overlay" />
      <div className="ot-route-layer">
        <Routes>
          <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-access" element={<ForgotAccessPage />} />

          <Route path="/equity" element={<ProtectedRoute><EquityLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/equity/stocks" replace />} />
            <Route path="stocks" element={<StockDetailPage />} />
            <Route path="security" element={<SecurityHubPage />} />
            <Route path="security/:ticker" element={<SecurityHubPage />} />
            <Route path="stocks/about" element={<AboutPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="screener" element={<ScreenerPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="portfolio/lab" element={<PortfolioLabPage />} />
            <Route path="portfolio/lab/portfolios/:id" element={<PortfolioLabDetailPage />} />
            <Route path="portfolio/lab/runs/:runId" element={<PortfolioLabRunReportPage />} />
            <Route path="portfolio/lab/blends" element={<PortfolioLabBlendsPage />} />
            <Route path="mutual-funds" element={<Navigate to="/equity/portfolio?mode=mutual_funds" replace />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="paper" element={<PaperTradingPage />} />
            <Route path="risk" element={<RiskDashboardPage />} />
            <Route path="oms" element={<OmsCompliancePage />} />
            <Route path="ops" element={<OpsDashboardPage />} />
            <Route path="plugins" element={<PluginsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="chart-workstation" element={<ChartWorkstationPage />} />
            <Route path="launchpad" element={<LaunchpadPage />} />
            <Route path="launchpad/popout" element={<LaunchpadPopoutPage />} />
            <Route path="compare" element={<SplitComparisonPage />} />
          </Route>

          <Route path="/fno" element={<ProtectedRoute><FnoLayout /></ProtectedRoute>}>
            <Route index element={<OptionChainPage />} />
            <Route path="greeks" element={<GreeksPage />} />
            <Route path="futures" element={<FuturesPage />} />
            <Route path="oi" element={<OIAnalysisPage />} />
            <Route path="strategy" element={<StrategyPage />} />
            <Route path="pcr" element={<PCRPage />} />
            <Route path="heatmap" element={<HeatmapPage />} />
            <Route path="expiry" element={<ExpiryPage />} />
            <Route path="about" element={<FnoAboutPage />} />
          </Route>

          <Route path="/backtesting" element={<ProtectedRoute><BacktestingLayout /></ProtectedRoute>}>
            <Route index element={<BacktestingPage />} />
            <Route path="model-lab" element={<ModelLabPage />} />
            <Route path="model-lab/experiments/:id" element={<ModelLabExperimentDetailPage />} />
            <Route path="model-lab/runs/:runId" element={<ModelLabRunReportPage />} />
            <Route path="model-lab/compare" element={<ModelLabComparePage />} />
            <Route path="model-governance" element={<ModelGovernancePage />} />
          </Route>

          <Route path="/account" element={<ProtectedRoute><AccountLayout /></ProtectedRoute>}>
            <Route index element={<AccountPage />} />
          </Route>

          <Route path="/cockpit" element={<ProtectedRoute><CockpitDashboard /></ProtectedRoute>} />
          <Route path="/model-lab" element={<ProtectedRoute><ModelLabPage /></ProtectedRoute>} />
          <Route path="/model-lab/experiments/:id" element={<ProtectedRoute><ModelLabExperimentDetailPage /></ProtectedRoute>} />
          <Route path="/model-lab/runs/:runId" element={<ProtectedRoute><ModelLabRunReportPage /></ProtectedRoute>} />
          <Route path="/model-lab/compare" element={<ProtectedRoute><ModelLabComparePage /></ProtectedRoute>} />
          <Route path="/portfolio-lab" element={<ProtectedRoute><PortfolioLabPage /></ProtectedRoute>} />
          <Route path="/portfolio-lab/portfolios/:id" element={<ProtectedRoute><PortfolioLabDetailPage /></ProtectedRoute>} />
          <Route path="/portfolio-lab/runs/:runId" element={<ProtectedRoute><PortfolioLabRunReportPage /></ProtectedRoute>} />
          <Route path="/portfolio-lab/blends" element={<ProtectedRoute><PortfolioLabBlendsPage /></ProtectedRoute>} />

          <Route path="/stocks" element={<Navigate to="/equity/stocks" replace />} />
          <Route path="/security" element={<Navigate to="/equity/security" replace />} />
          <Route path="/stocks/about" element={<Navigate to="/equity/stocks/about" replace />} />
          <Route path="/dashboard" element={<Navigate to="/equity/dashboard" replace />} />
          <Route path="/screener" element={<Navigate to="/equity/screener" replace />} />
          <Route path="/compare" element={<Navigate to="/equity/compare" replace />} />
          <Route path="/portfolio" element={<Navigate to="/equity/portfolio" replace />} />
          <Route path="/mutual-funds" element={<Navigate to="/equity/portfolio?mode=mutual_funds" replace />} />
          <Route path="/watchlist" element={<Navigate to="/equity/watchlist" replace />} />
          <Route path="/news" element={<Navigate to="/equity/news" replace />} />
          <Route path="/alerts" element={<Navigate to="/equity/alerts" replace />} />
          <Route path="/paper" element={<Navigate to="/equity/paper" replace />} />
          <Route path="/risk" element={<Navigate to="/equity/risk" replace />} />
          <Route path="/oms" element={<Navigate to="/equity/oms" replace />} />
          <Route path="/ops" element={<Navigate to="/equity/ops" replace />} />
          <Route path="/settings" element={<Navigate to="/equity/settings" replace />} />
          <Route path="/plugins" element={<Navigate to="/equity/plugins" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
