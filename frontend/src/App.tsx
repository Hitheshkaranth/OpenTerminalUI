import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { TerminalBackground } from "./components/TerminalBackground";
import { ThemeRuntime } from "./components/layout/ThemeRuntime";
import { lazyWithRetry } from "./utils/lazyWithRetry";

const EquityLayout = lazyWithRetry(() => import("./equity/EquityLayout").then((m) => ({ default: m.EquityLayout })));
const BacktestingLayout = lazyWithRetry(() => import("./pages/BacktestingLayout").then((m) => ({ default: m.BacktestingLayout })));
const FnoLayout = lazyWithRetry(() => import("./fno/FnoLayout").then((m) => ({ default: m.FnoLayout })));
const AccountLayout = lazyWithRetry(() => import("./pages/AccountLayout").then((m) => ({ default: m.AccountLayout })));

const HomePage = lazyWithRetry(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazyWithRetry(() => import("./pages/Auth/RegisterPage").then((m) => ({ default: m.RegisterPage })));
const ForgotAccessPage = lazyWithRetry(() => import("./pages/Auth/ForgotAccessPage").then((m) => ({ default: m.ForgotAccessPage })));

const StockDetailPage = lazyWithRetry(() => import("./pages/StockDetail").then((m) => ({ default: m.StockDetailPage })));
const SecurityHubPage = lazyWithRetry(() => import("./pages/SecurityHub").then((m) => ({ default: m.SecurityHubPage })));
const CommoditiesPage = lazyWithRetry(() => import("./pages/Commodities").then((m) => ({ default: m.CommoditiesPage })));
const ForexPage = lazyWithRetry(() => import("./pages/Forex").then((m) => ({ default: m.ForexPage })));
const HotlistsPage = lazyWithRetry(() => import("./pages/Hotlists").then((m) => ({ default: m.HotlistsPage })));
const InsiderActivityPage = lazyWithRetry(() => import("./pages/InsiderActivityPage").then((m) => ({ default: m.InsiderActivityPage })));
const AboutPage = lazyWithRetry(() => import("./pages/About").then((m) => ({ default: m.AboutPage })));
const DashboardPage = lazyWithRetry(() => import("./pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const ScreenerPage = lazyWithRetry(() => import("./pages/Screener").then((m) => ({ default: m.ScreenerPage })));
const PortfolioPage = lazyWithRetry(() => import("./pages/Portfolio").then((m) => ({ default: m.PortfolioPage })));
const WatchlistPage = lazyWithRetry(() => import("./pages/Watchlist").then((m) => ({ default: m.WatchlistPage })));
const NewsPage = lazyWithRetry(() => import("./pages/News").then((m) => ({ default: m.NewsPage })));
const AlertsPage = lazyWithRetry(() => import("./pages/Alerts").then((m) => ({ default: m.AlertsPage })));
const PaperTradingPage = lazyWithRetry(() => import("./pages/PaperTrading").then((m) => ({ default: m.PaperTradingPage })));
const PositionSizerPage = lazyWithRetry(() => import("./pages/PositionSizerPage").then((m) => ({ default: m.PositionSizerPage })));
const TradeJournalPage = lazyWithRetry(() => import("./pages/TradeJournalPage").then((m) => ({ default: m.TradeJournalPage })));
const RiskDashboardPage = lazyWithRetry(() => import("./pages/RiskDashboard").then((m) => ({ default: m.RiskDashboardPage })));
const CorrelationDashboardPage = lazyWithRetry(() => import("./pages/CorrelationDashboardPage").then((m) => ({ default: m.CorrelationDashboardPage })));
const OmsCompliancePage = lazyWithRetry(() => import("./pages/OmsCompliance").then((m) => ({ default: m.OmsCompliancePage })));
const OpsDashboardPage = lazyWithRetry(() => import("./pages/OpsDashboard").then((m) => ({ default: m.OpsDashboardPage })));
const SettingsPage = lazyWithRetry(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const PluginsPage = lazyWithRetry(() => import("./pages/Plugins/Plugins").then((m) => ({ default: m.PluginsPage })));
const ChartWorkstationPage = lazyWithRetry(() => import("./pages/ChartWorkstationPage").then((m) => ({ default: m.ChartWorkstationPage })));
const MultiTimeframePage = lazyWithRetry(() => import("./pages/MultiTimeframePage").then((m) => ({ default: m.MultiTimeframePage })));
const LaunchpadPage = lazyWithRetry(() => import("./pages/Launchpad").then((m) => ({ default: m.LaunchpadPage })));
const LaunchpadPopoutPage = lazyWithRetry(() => import("./pages/LaunchpadPopout").then((m) => ({ default: m.LaunchpadPopoutPage })));
const SplitComparisonPage = lazyWithRetry(() => import("./pages/SplitComparison").then((m) => ({ default: m.SplitComparisonPage })));
const YieldCurveDashboard = lazyWithRetry(() => import("./pages/fixed-income/YieldCurveDashboard").then((m) => ({ default: m.YieldCurveDashboard })));
const EconomicTerminal = lazyWithRetry(() => import("./pages/economics/EconomicTerminal").then((m) => ({ default: m.EconomicTerminal })));
const SectorRotationPage = lazyWithRetry(() => import("./pages/SectorRotation").then((m) => ({ default: m.SectorRotationPage })));
const CryptoWorkspacePage = lazyWithRetry(() => import("./pages/CryptoWorkspace").then((m) => ({ default: m.CryptoWorkspacePage })));
const BondsPage = lazyWithRetry(() => import("./pages/equity/bonds/Bonds").then((m) => ({ default: m.BondsPage })));
const ETFAnalyticsPage = lazyWithRetry(() => import("./pages/ETFAnalytics").then((m) => ({ default: m.ETFAnalyticsPage })));
const MutualFundsPage = lazyWithRetry(() => import("./pages/MutualFunds").then((m) => ({ default: m.MutualFundsPage })));
const MarketHeatmapPage = lazyWithRetry(() => import("./pages/MarketHeatmapPage").then((m) => ({ default: m.MarketHeatmapPage })));
const DividendDashboardPage = lazyWithRetry(() => import("./pages/DividendDashboardPage").then((m) => ({ default: m.DividendDashboardPage })));
const TimeAndSalesPage = lazyWithRetry(() => import("./pages/TimeAndSalesPage").then((m) => ({ default: m.TimeAndSalesPage })));
const DOMPage = lazyWithRetry(() => import("./pages/DOMPage").then((m) => ({ default: m.DOMPage })));

const OptionChainPage = lazyWithRetry(() => import("./fno/pages/OptionChainPage").then((m) => ({ default: m.OptionChainPage })));
const GreeksPage = lazyWithRetry(() => import("./fno/pages/GreeksPage").then((m) => ({ default: m.GreeksPage })));
const FuturesPage = lazyWithRetry(() => import("./fno/pages/FuturesPage").then((m) => ({ default: m.FuturesPage })));
const OIAnalysisPage = lazyWithRetry(() => import("./fno/pages/OIAnalysisPage").then((m) => ({ default: m.OIAnalysisPage })));
const StrategyPage = lazyWithRetry(() => import("./fno/pages/StrategyPage").then((m) => ({ default: m.StrategyPage })));
const PCRPage = lazyWithRetry(() => import("./fno/pages/PCRPage").then((m) => ({ default: m.PCRPage })));
const OptionsFlowPage = lazyWithRetry(() => import("./fno/pages/OptionsFlowPage").then((m) => ({ default: m.OptionsFlowPage })));
const RelativeStrengthPage = lazyWithRetry(() => import("./pages/RelativeStrengthPage").then((m) => ({ default: m.RelativeStrengthPage })));
const DataQualityDashboard = lazyWithRetry(() => import("./pages/DataQualityDashboard").then((m) => ({ default: m.DataQualityDashboard })));
const HeatmapPage = lazyWithRetry(() => import("./fno/pages/HeatmapPage").then((m) => ({ default: m.HeatmapPage })));
const ExpiryPage = lazyWithRetry(() => import("./fno/pages/ExpiryPage").then((m) => ({ default: m.ExpiryPage })));
const FnoAboutPage = lazyWithRetry(() => import("./fno/pages/AboutPage").then((m) => ({ default: m.FnoAboutPage })));

const BacktestingPage = lazyWithRetry(() => import("./pages/Backtesting").then((m) => ({ default: m.BacktestingPage })));
const ModelLabPage = lazyWithRetry(() => import("./pages/ModelLab").then((m) => ({ default: m.ModelLabPage })));
const ModelLabExperimentDetailPage = lazyWithRetry(() => import("./pages/ModelLabExperimentDetail").then((m) => ({ default: m.ModelLabExperimentDetailPage })));
const ModelLabRunReportPage = lazyWithRetry(() => import("./pages/ModelLabRunReport").then((m) => ({ default: m.ModelLabRunReportPage })));
const ModelLabComparePage = lazyWithRetry(() => import("./pages/ModelLabCompare").then((m) => ({ default: m.ModelLabComparePage })));
const ModelGovernancePage = lazyWithRetry(() => import("./pages/ModelGovernance").then((m) => ({ default: m.ModelGovernancePage })));

const PortfolioLabPage = lazyWithRetry(() => import("./pages/PortfolioLab").then((m) => ({ default: m.PortfolioLabPage })));
const PortfolioLabDetailPage = lazyWithRetry(() => import("./pages/PortfolioLabDetail").then((m) => ({ default: m.PortfolioLabDetailPage })));
const PortfolioLabRunReportPage = lazyWithRetry(() => import("./pages/PortfolioLabRunReport").then((m) => ({ default: m.PortfolioLabRunReportPage })));
const PortfolioLabBlendsPage = lazyWithRetry(() => import("./pages/PortfolioLabBlends").then((m) => ({ default: m.PortfolioLabBlendsPage })));

const AccountPage = lazyWithRetry(() => import("./pages/Account").then((m) => ({ default: m.AccountPage })));
const CockpitDashboard = lazyWithRetry(() => import("./pages/Cockpit"));

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
        <ErrorBoundary>
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
            <Route path="commodities" element={<CommoditiesPage />} />
            <Route path="forex" element={<ForexPage />} />
            <Route path="hotlists" element={<HotlistsPage />} />
            <Route path="insider" element={<InsiderActivityPage />} />
            <Route path="stocks/about" element={<AboutPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="heatmap" element={<MarketHeatmapPage />} />
            <Route path="dividends" element={<DividendDashboardPage />} />
            <Route path="rs" element={<RelativeStrengthPage />} />
            <Route path="data-quality" element={<DataQualityDashboard />} />
            <Route path="screener" element={<ScreenerPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="portfolio/lab" element={<PortfolioLabPage />} />
            <Route path="portfolio/lab/portfolios/:id" element={<PortfolioLabDetailPage />} />
            <Route path="portfolio/lab/runs/:runId" element={<PortfolioLabRunReportPage />} />
            <Route path="portfolio/lab/blends" element={<PortfolioLabBlendsPage />} />
            <Route path="mutual-funds" element={<MutualFundsPage />} />
            <Route path="bonds" element={<BondsPage />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="news" element={<NewsPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="paper" element={<PaperTradingPage />} />
            <Route path="position-sizer" element={<PositionSizerPage />} />
            <Route path="journal" element={<TradeJournalPage />} />
            <Route path="risk" element={<RiskDashboardPage />} />
            <Route path="correlation" element={<CorrelationDashboardPage />} />
            <Route path="oms" element={<OmsCompliancePage />} />
            <Route path="ops" element={<OpsDashboardPage />} />
            <Route path="plugins" element={<PluginsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="chart-workstation" element={<ChartWorkstationPage />} />
            <Route path="mta" element={<MultiTimeframePage />} />
            <Route path="dom" element={<DOMPage />} />
            <Route path="tape" element={<TimeAndSalesPage />} />
            <Route path="launchpad" element={<LaunchpadPage />} />
            <Route path="launchpad/popout" element={<LaunchpadPopoutPage />} />
            <Route path="compare" element={<SplitComparisonPage />} />
            <Route path="yield-curve" element={<YieldCurveDashboard />} />
            <Route path="economics" element={<EconomicTerminal />} />
            <Route path="sector-rotation" element={<SectorRotationPage />} />
            <Route path="crypto" element={<CryptoWorkspacePage />} />
            <Route path="etf-analytics" element={<ETFAnalyticsPage />} />
            <Route path="cockpit" element={<CockpitDashboard />} />
          </Route>

          <Route path="/fno" element={<ProtectedRoute><FnoLayout /></ProtectedRoute>}>
            <Route index element={<OptionChainPage />} />
            <Route path="greeks" element={<GreeksPage />} />
            <Route path="futures" element={<FuturesPage />} />
            <Route path="oi" element={<OIAnalysisPage />} />
            <Route path="strategy" element={<StrategyPage />} />
            <Route path="pcr" element={<PCRPage />} />
            <Route path="flow" element={<OptionsFlowPage />} />
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
          <Route path="/commodities" element={<Navigate to="/equity/commodities" replace />} />
          <Route path="/forex" element={<Navigate to="/equity/forex" replace />} />
          <Route path="/hotlists" element={<Navigate to="/equity/hotlists" replace />} />
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
          <Route path="/correlation" element={<Navigate to="/equity/correlation" replace />} />
          <Route path="/oms" element={<Navigate to="/equity/oms" replace />} />
          <Route path="/ops" element={<Navigate to="/equity/ops" replace />} />
          <Route path="/settings" element={<Navigate to="/equity/settings" replace />} />
          <Route path="/plugins" element={<Navigate to="/equity/plugins" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

export default App;
