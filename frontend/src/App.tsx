import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { TerminalBackground } from "./components/TerminalBackground";
import { ThemeRuntime } from "./components/layout/ThemeRuntime";

const EquityLayout = lazy(() => import("./equity/EquityLayout").then((m) => ({ default: m.EquityLayout })));
const BacktestingLayout = lazy(() => import("./pages/BacktestingLayout").then((m) => ({ default: m.BacktestingLayout })));
const FnoLayout = lazy(() => import("./fno/FnoLayout").then((m) => ({ default: m.FnoLayout })));
const AccountLayout = lazy(() => import("./pages/AccountLayout").then((m) => ({ default: m.AccountLayout })));

const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/Auth/RegisterPage").then((m) => ({ default: m.RegisterPage })));
const ForgotAccessPage = lazy(() => import("./pages/Auth/ForgotAccessPage").then((m) => ({ default: m.ForgotAccessPage })));

const StockDetailPage = lazy(() => import("./pages/StockDetail").then((m) => ({ default: m.StockDetailPage })));
const SecurityHubPage = lazy(() => import("./pages/SecurityHub").then((m) => ({ default: m.SecurityHubPage })));
const AboutPage = lazy(() => import("./pages/About").then((m) => ({ default: m.AboutPage })));
const DashboardPage = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const ScreenerPage = lazy(() => import("./pages/Screener").then((m) => ({ default: m.ScreenerPage })));
const PortfolioPage = lazy(() => import("./pages/Portfolio").then((m) => ({ default: m.PortfolioPage })));
const WatchlistPage = lazy(() => import("./pages/Watchlist").then((m) => ({ default: m.WatchlistPage })));
const NewsPage = lazy(() => import("./pages/News").then((m) => ({ default: m.NewsPage })));
const AlertsPage = lazy(() => import("./pages/Alerts").then((m) => ({ default: m.AlertsPage })));
const PaperTradingPage = lazy(() => import("./pages/PaperTrading").then((m) => ({ default: m.PaperTradingPage })));
const RiskDashboardPage = lazy(() => import("./pages/RiskDashboard").then((m) => ({ default: m.RiskDashboardPage })));
const OmsCompliancePage = lazy(() => import("./pages/OmsCompliance").then((m) => ({ default: m.OmsCompliancePage })));
const OpsDashboardPage = lazy(() => import("./pages/OpsDashboard").then((m) => ({ default: m.OpsDashboardPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const PluginsPage = lazy(() => import("./pages/Plugins/Plugins").then((m) => ({ default: m.PluginsPage })));
const ChartWorkstationPage = lazy(() => import("./pages/ChartWorkstationPage").then((m) => ({ default: m.ChartWorkstationPage })));
const LaunchpadPage = lazy(() => import("./pages/Launchpad").then((m) => ({ default: m.LaunchpadPage })));
const LaunchpadPopoutPage = lazy(() => import("./pages/LaunchpadPopout").then((m) => ({ default: m.LaunchpadPopoutPage })));
const SplitComparisonPage = lazy(() => import("./pages/SplitComparison").then((m) => ({ default: m.SplitComparisonPage })));
const YieldCurveDashboard = lazy(() => import("./pages/fixed-income/YieldCurveDashboard").then((m) => ({ default: m.YieldCurveDashboard })));
const EconomicTerminal = lazy(() => import("./pages/economics/EconomicTerminal").then((m) => ({ default: m.EconomicTerminal })));
const SectorRotationPage = lazy(() => import("./pages/SectorRotation").then((m) => ({ default: m.SectorRotationPage })));
const CryptoWorkspacePage = lazy(() => import("./pages/CryptoWorkspace").then((m) => ({ default: m.CryptoWorkspacePage })));

const OptionChainPage = lazy(() => import("./fno/pages/OptionChainPage").then((m) => ({ default: m.OptionChainPage })));
const GreeksPage = lazy(() => import("./fno/pages/GreeksPage").then((m) => ({ default: m.GreeksPage })));
const FuturesPage = lazy(() => import("./fno/pages/FuturesPage").then((m) => ({ default: m.FuturesPage })));
const OIAnalysisPage = lazy(() => import("./fno/pages/OIAnalysisPage").then((m) => ({ default: m.OIAnalysisPage })));
const StrategyPage = lazy(() => import("./fno/pages/StrategyPage").then((m) => ({ default: m.StrategyPage })));
const PCRPage = lazy(() => import("./fno/pages/PCRPage").then((m) => ({ default: m.PCRPage })));
const HeatmapPage = lazy(() => import("./fno/pages/HeatmapPage").then((m) => ({ default: m.HeatmapPage })));
const ExpiryPage = lazy(() => import("./fno/pages/ExpiryPage").then((m) => ({ default: m.ExpiryPage })));
const FnoAboutPage = lazy(() => import("./fno/pages/AboutPage").then((m) => ({ default: m.FnoAboutPage })));

const BacktestingPage = lazy(() => import("./pages/Backtesting").then((m) => ({ default: m.BacktestingPage })));
const ModelLabPage = lazy(() => import("./pages/ModelLab").then((m) => ({ default: m.ModelLabPage })));
const ModelLabExperimentDetailPage = lazy(() => import("./pages/ModelLabExperimentDetail").then((m) => ({ default: m.ModelLabExperimentDetailPage })));
const ModelLabRunReportPage = lazy(() => import("./pages/ModelLabRunReport").then((m) => ({ default: m.ModelLabRunReportPage })));
const ModelLabComparePage = lazy(() => import("./pages/ModelLabCompare").then((m) => ({ default: m.ModelLabComparePage })));
const ModelGovernancePage = lazy(() => import("./pages/ModelGovernance").then((m) => ({ default: m.ModelGovernancePage })));

const PortfolioLabPage = lazy(() => import("./pages/PortfolioLab").then((m) => ({ default: m.PortfolioLabPage })));
const PortfolioLabDetailPage = lazy(() => import("./pages/PortfolioLabDetail").then((m) => ({ default: m.PortfolioLabDetailPage })));
const PortfolioLabRunReportPage = lazy(() => import("./pages/PortfolioLabRunReport").then((m) => ({ default: m.PortfolioLabRunReportPage })));
const PortfolioLabBlendsPage = lazy(() => import("./pages/PortfolioLabBlends").then((m) => ({ default: m.PortfolioLabBlendsPage })));

const AccountPage = lazy(() => import("./pages/Account").then((m) => ({ default: m.AccountPage })));
const CockpitDashboard = lazy(() => import("./pages/Cockpit"));

const RouteLoadingFallback = (
  <div className="flex min-h-[50vh] items-center justify-center p-4">
    <div className="rounded-sm border border-terminal-border bg-terminal-panel px-4 py-3 text-xs text-terminal-muted">
      Loading workspace...
    </div>
  </div>
);

function App() {
  return (
    <div className="ot-app-shell">
      <ThemeRuntime />
      <TerminalBackground />
      <div className="ot-vignette-overlay" />
      <div className="ot-scanline-overlay" />
      <div className="ot-route-layer">
        <Suspense fallback={RouteLoadingFallback}>
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
            <Route path="yield-curve" element={<YieldCurveDashboard />} />
            <Route path="economics" element={<EconomicTerminal />} />
            <Route path="sector-rotation" element={<SectorRotationPage />} />
            <Route path="crypto" element={<CryptoWorkspacePage />} />
            <Route path="cockpit" element={<CockpitDashboard />} />
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

          <Route path="/cockpit" element={<Navigate to="/equity/cockpit" replace />} />
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
        </Suspense>
      </div>
    </div>
  );
}

export default App;
