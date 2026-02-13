#!/usr/bin/env python3
"""PySide6 GUI for the fundamental screener (Stages 1-3)."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import requests
import yaml
from PySide6.QtCore import QDate, QDateTime, QTimer, Qt
from PySide6.QtCharts import (
    QCandlestickSeries,
    QCandlestickSet,
    QChart,
    QChartView,
    QDateTimeAxis,
    QLineSeries,
    QValueAxis,
)
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QComboBox,
    QDateEdit,
    QDoubleSpinBox,
    QFrame,
    QFormLayout,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QTextEdit,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from core.alerts import AlertRule, append_alert_log, evaluate_alert_rule
from core.backtester import BacktestConfig, backtest_momentum_rotation
from core.data_fetcher import MarketDataFetcher
from core.normalizer import normalize_snapshot
from core.peers import build_peer_comparison
from core.ratios import compute_ratios
from core.screener import Rule, ScreenerEngine
from core.valuation import (
    DcfInputs,
    DcfStage,
    build_sensitivity_table,
    multi_stage_fcff_dcf,
    reverse_dcf_implied_growth,
    run_dcf_scenarios,
)


ROOT = Path(__file__).resolve().parents[1]
ALERT_LOG_PATH = ROOT / "data" / "processed" / "alerts_log.csv"
SCREENERS_CONFIG_PATH = ROOT / "config" / "screeners.yaml"
NSE_SYMBOL_CSV = ROOT / "data" / "nse_equity_symbols_eq.csv"
NSE_SYMBOL_TXT = ROOT / "data" / "nse_equity_symbols_eq.txt"


def parse_tickers(raw: str) -> list[str]:
    parts = [p.strip().upper() for p in raw.replace(",", " ").split()]
    return list(dict.fromkeys([p for p in parts if p]))


def _safe_float(v, fallback: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return fallback


def _fmt_num(v, digits: int = 2) -> str:
    if isinstance(v, (int, float)):
        return f"{float(v):,.{digits}f}"
    return "N/A"


def _fmt_pct(v) -> str:
    if isinstance(v, (int, float)):
        return f"{float(v) * 100:.2f}%"
    return "N/A"


def _compact_currency(value) -> str:
    if not isinstance(value, (int, float)):
        return "N/A"
    n = float(value)
    a = abs(n)
    if a >= 1_00_00_00_000:
        return f"INR {n/1_00_00_00_000:.2f} Bn"
    if a >= 1_00_00_000:
        return f"INR {n/1_00_00_000:.2f} Cr"
    if a >= 1_00_000:
        return f"INR {n/1_00_000:.2f} L"
    return f"INR {n:,.2f}"


def load_screener_presets() -> dict:
    if not SCREENERS_CONFIG_PATH.exists():
        return {}
    try:
        return yaml.safe_load(SCREENERS_CONFIG_PATH.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def load_nse_symbol_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    if NSE_SYMBOL_CSV.exists():
        try:
            df = pd.read_csv(NSE_SYMBOL_CSV)
            symbol_col = next((c for c in df.columns if c.strip().upper() == "SYMBOL"), None)
            name_col = next((c for c in df.columns if c.strip().upper() == "NAME OF COMPANY"), None)
            if symbol_col:
                for _, row in df.iterrows():
                    sym = str(row.get(symbol_col, "")).strip().upper().replace(".NS", "")
                    if not sym:
                        continue
                    name = str(row.get(name_col, "")).strip() if name_col else ""
                    rows.append({"symbol": sym, "name": name})
        except Exception:
            rows = []
    if not rows and NSE_SYMBOL_TXT.exists():
        for line in NSE_SYMBOL_TXT.read_text(encoding="utf-8").splitlines():
            sym = line.strip().upper().replace(".NS", "")
            if sym:
                rows.append({"symbol": sym, "name": ""})
    uniq = {}
    for row in rows:
        uniq[row["symbol"]] = row
    return [uniq[k] for k in sorted(uniq.keys())]


class FundamentalWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Trade_Screens Bloomberg-Style Fundamental Terminal")
        self.resize(1500, 920)

        self.df = pd.DataFrame()
        self.latest_alerts = pd.DataFrame()
        self.latest_backtest: dict | None = None
        self.screener_presets = load_screener_presets()
        self.nse_symbol_rows = load_nse_symbol_rows()
        self.nse_symbols = [row["symbol"] for row in self.nse_symbol_rows]

        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(4)

        top_strip = QFrame()
        top_strip.setObjectName("TopStrip")
        top_layout = QHBoxLayout(top_strip)
        top_layout.setContentsMargins(8, 4, 8, 4)
        top_layout.setSpacing(14)
        self.mode_label = QLabel("MODE: FUNDAMENTAL")
        self.mode_label.setObjectName("TopStripLabel")
        self.exchange_label = QLabel("EXCHANGE: NSE")
        self.exchange_label.setObjectName("TopStripLabel")
        self.market_tape_label = QLabel("TAPE: WAITING FOR DATA")
        self.market_tape_label.setObjectName("TopStripLabel")
        self.global_symbol_combo = QComboBox()
        self.global_symbol_combo.setEditable(True)
        self.global_symbol_combo.setInsertPolicy(QComboBox.NoInsert)
        self.global_symbol_combo.setMaximumWidth(220)
        self.global_symbol_combo.setPlaceholderText("Select NSE ticker")
        self.global_symbol_combo.addItems(self.nse_symbols)
        self.global_symbol_combo.currentTextChanged.connect(self._on_global_symbol_changed)
        self.global_add_btn = QPushButton("ADD")
        self.global_add_btn.clicked.connect(self._add_global_symbol_to_screener)
        self.clock_label = QLabel("LOCAL 00 Jan 0000 00:00:00")
        self.clock_label.setObjectName("TopStripLabel")
        top_layout.addWidget(self.mode_label)
        top_layout.addWidget(self.exchange_label)
        top_layout.addWidget(QLabel("SYMBOL"))
        top_layout.addWidget(self.global_symbol_combo)
        top_layout.addWidget(self.global_add_btn)
        top_layout.addWidget(self.market_tape_label, 1)
        top_layout.addWidget(self.clock_label)
        layout.addWidget(top_strip)

        self.status_label = QLabel("IDLE")
        self.status_label.setObjectName("Status")
        layout.addWidget(self.status_label)

        self.tabs = QTabWidget()
        layout.addWidget(self.tabs, 1)

        self._build_screener_tab()
        self._build_market_tab()
        self._build_valuation_tab()
        self._build_peer_tab()
        self._build_backtest_tab()
        self._build_alert_tab()
        self._build_symbol_tab()
        self._populate_ticker_combos()
        self.command_line = QLineEdit("Type command: SCREENER | MARKET | VALUATION | PEERS | BACKTEST | ALERTS | SYMBOLS")
        self.command_line.returnPressed.connect(self._execute_terminal_command)
        layout.addWidget(self.command_line)
        self._apply_theme()
        self._style_tables()
        self._update_clock()
        self.clock_timer = QTimer(self)
        self.clock_timer.timeout.connect(self._update_clock)
        self.clock_timer.start(1000)

    def _build_screener_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)

        form = QFormLayout()
        self.ticker_input = QLineEdit("RELIANCE TCS INFY HDFCBANK ICICIBANK LT")
        self.preset_combo = QComboBox()
        preset_names = sorted(self.screener_presets.keys()) if self.screener_presets else ["value", "quality", "growth"]
        self.preset_combo.addItems(preset_names)
        self.max_pe_spin = QDoubleSpinBox()
        self.max_pe_spin.setRange(0.0, 500.0)
        self.max_pe_spin.setValue(25.0)
        self.min_roe_spin = QDoubleSpinBox()
        self.min_roe_spin.setRange(0.0, 200.0)
        self.min_roe_spin.setValue(12.0)
        self.top_n_spin = QSpinBox()
        self.top_n_spin.setRange(1, 500)
        self.top_n_spin.setValue(25)
        form.addRow("Tickers", self.ticker_input)
        form.addRow("Preset", self.preset_combo)
        form.addRow("Max P/E", self.max_pe_spin)
        form.addRow("Min ROE %", self.min_roe_spin)
        form.addRow("Top N", self.top_n_spin)
        l.addLayout(form)

        btn_row = QHBoxLayout()
        run_btn = QPushButton("Fetch + Run Screener")
        run_btn.clicked.connect(self.run_screener)
        btn_row.addWidget(run_btn)
        btn_row.addStretch(1)
        l.addLayout(btn_row)

        self.screener_table = QTableWidget()
        l.addWidget(self.screener_table, 1)
        self.tabs.addTab(tab, "SCREENER")

    def _build_market_tab(self) -> None:
        tab = QWidget()
        root = QVBoxLayout(tab)

        top = QHBoxLayout()
        self.market_ticker_combo = QComboBox()
        self.market_ticker_combo.setEditable(True)
        self.market_ticker_combo.addItems(self.nse_symbols)
        self.market_ticker_combo.currentTextChanged.connect(self._on_market_symbol_changed)
        self.market_range_combo = QComboBox()
        self.market_range_combo.addItems(["1M", "3M", "6M", "1Y"])
        self.market_interval_combo = QComboBox()
        self.market_interval_combo.addItems(["1d", "1h", "30m"])
        load_btn = QPushButton("Load Market View")
        load_btn.clicked.connect(self.load_market_view)
        top.addWidget(QLabel("Ticker"))
        top.addWidget(self.market_ticker_combo)
        top.addWidget(QLabel("Range"))
        top.addWidget(self.market_range_combo)
        top.addWidget(QLabel("Interval"))
        top.addWidget(self.market_interval_combo)
        top.addWidget(load_btn)
        top.addStretch(1)
        root.addLayout(top)

        splitter = QSplitter(Qt.Horizontal)
        root.addWidget(splitter, 1)

        left = QWidget()
        left_l = QVBoxLayout(left)
        self.company_summary = QTextEdit()
        self.company_summary.setReadOnly(True)
        self.company_summary.setPlaceholderText("Company details and profile will appear here.")
        left_l.addWidget(QLabel("Company Details"))
        left_l.addWidget(self.company_summary, 1)
        self.market_metrics = QTableWidget()
        left_l.addWidget(QLabel("Pricing Information"))
        left_l.addWidget(self.market_metrics, 1)
        splitter.addWidget(left)

        right = QWidget()
        right_l = QVBoxLayout(right)
        self.price_chart = QChart()
        self.price_chart.setBackgroundVisible(True)
        self.price_chart.setBackgroundBrush(Qt.black)
        self.price_chart.setPlotAreaBackgroundVisible(True)
        self.price_chart.setPlotAreaBackgroundBrush(Qt.black)
        self.price_chart.legend().hide()
        self.price_chart_view = QChartView(self.price_chart)
        self.price_chart_view.setMinimumHeight(280)
        right_l.addWidget(QLabel("Price Chart"))
        right_l.addWidget(self.price_chart_view, 1)
        self.quarterly_results_table = QTableWidget()
        right_l.addWidget(QLabel("Quarterly Results"))
        right_l.addWidget(self.quarterly_results_table, 1)
        splitter.addWidget(right)
        splitter.setSizes([550, 900])

        self.tabs.addTab(tab, "MARKET VIEW")

    def _build_valuation_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)
        form = QGridLayout()
        self.val_ticker_combo = QComboBox()
        self.val_years = QSpinBox()
        self.val_years.setRange(3, 15)
        self.val_years.setValue(5)
        self.val_growth = QDoubleSpinBox()
        self.val_growth.setRange(-20.0, 60.0)
        self.val_growth.setValue(10.0)
        self.val_discount = QDoubleSpinBox()
        self.val_discount.setRange(1.0, 30.0)
        self.val_discount.setValue(12.0)
        self.val_terminal = QDoubleSpinBox()
        self.val_terminal.setRange(0.0, 8.0)
        self.val_terminal.setValue(4.0)
        form.addWidget(QLabel("Ticker"), 0, 0)
        form.addWidget(self.val_ticker_combo, 0, 1)
        form.addWidget(QLabel("Years"), 0, 2)
        form.addWidget(self.val_years, 0, 3)
        form.addWidget(QLabel("Growth %"), 1, 0)
        form.addWidget(self.val_growth, 1, 1)
        form.addWidget(QLabel("Discount %"), 1, 2)
        form.addWidget(self.val_discount, 1, 3)
        form.addWidget(QLabel("Terminal %"), 1, 4)
        form.addWidget(self.val_terminal, 1, 5)
        l.addLayout(form)

        run_btn = QPushButton("Run Valuation")
        run_btn.clicked.connect(self.run_valuation)
        l.addWidget(run_btn)

        self.val_metrics = QLabel("Enterprise: - | Equity: - | Intrinsic/Share: - | Upside: -")
        l.addWidget(self.val_metrics)

        self.val_projection_table = QTableWidget()
        self.val_scenarios_table = QTableWidget()
        self.val_sensitivity_table = QTableWidget()
        l.addWidget(QLabel("Projection"))
        l.addWidget(self.val_projection_table, 1)
        l.addWidget(QLabel("Scenarios"))
        l.addWidget(self.val_scenarios_table, 1)
        l.addWidget(QLabel("Sensitivity"))
        l.addWidget(self.val_sensitivity_table, 1)

        self.tabs.addTab(tab, "VALUATION")

    def _build_peer_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)
        row = QHBoxLayout()
        self.peer_ticker_combo = QComboBox()
        run_btn = QPushButton("Run Peer Comparison")
        run_btn.clicked.connect(self.run_peers)
        row.addWidget(QLabel("Ticker"))
        row.addWidget(self.peer_ticker_combo)
        row.addWidget(run_btn)
        row.addStretch(1)
        l.addLayout(row)
        self.peer_table = QTableWidget()
        l.addWidget(self.peer_table, 1)
        self.tabs.addTab(tab, "PEER COMPARISON")

    def _build_backtest_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)
        grid = QGridLayout()
        self.bt_start = QDateEdit()
        self.bt_start.setCalendarPopup(True)
        self.bt_start.setDate(QDate(2020, 1, 1))
        self.bt_end = QDateEdit()
        self.bt_end.setCalendarPopup(True)
        self.bt_end.setDate(QDate.currentDate())
        self.bt_rebalance = QComboBox()
        self.bt_rebalance.addItems(["W-FRI", "M", "Q"])
        self.bt_lookback = QSpinBox()
        self.bt_lookback.setRange(20, 252)
        self.bt_lookback.setValue(63)
        self.bt_topn = QSpinBox()
        self.bt_topn.setRange(1, 50)
        self.bt_topn.setValue(5)
        self.bt_cost = QDoubleSpinBox()
        self.bt_cost.setRange(0.0, 200.0)
        self.bt_cost.setValue(10.0)
        self.bt_bench = QLineEdit("^NSEI")
        grid.addWidget(QLabel("Start"), 0, 0)
        grid.addWidget(self.bt_start, 0, 1)
        grid.addWidget(QLabel("End"), 0, 2)
        grid.addWidget(self.bt_end, 0, 3)
        grid.addWidget(QLabel("Rebalance"), 0, 4)
        grid.addWidget(self.bt_rebalance, 0, 5)
        grid.addWidget(QLabel("Lookback"), 1, 0)
        grid.addWidget(self.bt_lookback, 1, 1)
        grid.addWidget(QLabel("Top N"), 1, 2)
        grid.addWidget(self.bt_topn, 1, 3)
        grid.addWidget(QLabel("Tx Cost bps"), 1, 4)
        grid.addWidget(self.bt_cost, 1, 5)
        grid.addWidget(QLabel("Benchmark"), 1, 6)
        grid.addWidget(self.bt_bench, 1, 7)
        l.addLayout(grid)

        run_btn = QPushButton("Run Backtest")
        run_btn.clicked.connect(self.run_backtest)
        l.addWidget(run_btn)
        self.bt_summary = QLabel("Strategy: - | Benchmark: - | Alpha: -")
        l.addWidget(self.bt_summary)
        self.bt_holdings_table = QTableWidget()
        l.addWidget(self.bt_holdings_table, 1)
        self.tabs.addTab(tab, "BACKTESTING")

    def _build_alert_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)
        grid = QGridLayout()
        self.alert_name = QLineEdit("Custom Alert")
        self.alert_field = QComboBox()
        self.alert_op = QComboBox()
        self.alert_op.addItems([">", "<", ">=", "<=", "==", "!="])
        self.alert_threshold = QDoubleSpinBox()
        self.alert_threshold.setRange(-1_000_000_000.0, 1_000_000_000.0)
        self.alert_threshold.setValue(10.0)
        self.alert_sev = QComboBox()
        self.alert_sev.addItems(["low", "medium", "high"])
        grid.addWidget(QLabel("Name"), 0, 0)
        grid.addWidget(self.alert_name, 0, 1)
        grid.addWidget(QLabel("Field"), 0, 2)
        grid.addWidget(self.alert_field, 0, 3)
        grid.addWidget(QLabel("Operator"), 1, 0)
        grid.addWidget(self.alert_op, 1, 1)
        grid.addWidget(QLabel("Threshold"), 1, 2)
        grid.addWidget(self.alert_threshold, 1, 3)
        grid.addWidget(QLabel("Severity"), 1, 4)
        grid.addWidget(self.alert_sev, 1, 5)
        l.addLayout(grid)

        btn_row = QHBoxLayout()
        run_btn = QPushButton("Run Alert Check")
        run_btn.clicked.connect(self.run_alerts)
        save_btn = QPushButton("Append Alerts To Log")
        save_btn.clicked.connect(self.save_alerts_log)
        btn_row.addWidget(run_btn)
        btn_row.addWidget(save_btn)
        btn_row.addStretch(1)
        l.addLayout(btn_row)

        self.alerts_table = QTableWidget()
        self.alert_history = QTextEdit()
        self.alert_history.setReadOnly(True)
        l.addWidget(QLabel("Triggered Alerts"))
        l.addWidget(self.alerts_table, 1)
        l.addWidget(QLabel("Alert Log (latest 200 rows)"))
        l.addWidget(self.alert_history, 1)
        self.tabs.addTab(tab, "ALERTS")

    def _build_symbol_tab(self) -> None:
        tab = QWidget()
        l = QVBoxLayout(tab)

        top = QHBoxLayout()
        self.symbol_search = QLineEdit()
        self.symbol_search.setPlaceholderText("Search NSE symbols or company names")
        self.symbol_search.textChanged.connect(self._refresh_symbol_list)
        self.symbol_count_label = QLabel("NSE Symbols: 0")
        refresh_btn = QPushButton("Refresh Symbols")
        refresh_btn.clicked.connect(self._reload_nse_symbols)
        top.addWidget(QLabel("Search"))
        top.addWidget(self.symbol_search, 1)
        top.addWidget(self.symbol_count_label)
        top.addWidget(refresh_btn)
        l.addLayout(top)

        self.symbol_list = QListWidget()
        self.symbol_list.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.symbol_list.itemSelectionChanged.connect(self._sync_symbol_selection_across_screens)
        l.addWidget(self.symbol_list, 1)

        btn_row = QHBoxLayout()
        add_selected_btn = QPushButton("Add Selected To Screener")
        add_selected_btn.clicked.connect(self._add_selected_symbols_to_input)
        add_filtered_btn = QPushButton("Add All Filtered")
        add_filtered_btn.clicked.connect(self._add_filtered_symbols_to_input)
        btn_row.addWidget(add_selected_btn)
        btn_row.addWidget(add_filtered_btn)
        btn_row.addStretch(1)
        l.addLayout(btn_row)

        self.tabs.addTab(tab, "NSE SYMBOLS")
        self._refresh_symbol_list()

    def _populate_ticker_combos(self) -> None:
        selected_global = self.global_symbol_combo.currentText().strip().upper() if hasattr(self, "global_symbol_combo") else ""
        for combo in (self.market_ticker_combo, self.val_ticker_combo, self.peer_ticker_combo):
            current = combo.currentText().strip().upper()
            combo.blockSignals(True)
            combo.clear()
            combo.addItems(self.nse_symbols)
            if current and current in self.nse_symbols:
                combo.setCurrentText(current)
            elif selected_global and selected_global in self.nse_symbols:
                combo.setCurrentText(selected_global)
            combo.blockSignals(False)

    def _on_global_symbol_changed(self, symbol: str) -> None:
        sym = symbol.strip().upper()
        if not sym:
            return
        if sym in self.nse_symbols:
            self.market_ticker_combo.setCurrentText(sym)
            self.val_ticker_combo.setCurrentText(sym)
            self.peer_ticker_combo.setCurrentText(sym)
            self.load_market_view()
            self._set_status(f"symbol selected -> {sym}")

    def _add_global_symbol_to_screener(self) -> None:
        sym = self.global_symbol_combo.currentText().strip().upper()
        if not sym:
            return
        existing = parse_tickers(self.ticker_input.text())
        merged = list(dict.fromkeys(existing + [sym]))
        self.ticker_input.setText(" ".join(merged))
        self.market_ticker_combo.setCurrentText(sym)
        self.val_ticker_combo.setCurrentText(sym)
        self.peer_ticker_combo.setCurrentText(sym)
        self.load_market_view()
        self._set_status(f"added symbol to screener -> {sym}")

    def _sync_symbol_selection_across_screens(self) -> None:
        selected = [x.data(Qt.UserRole) for x in self.symbol_list.selectedItems()]
        if not selected:
            return
        lead = str(selected[0]).strip().upper()
        if lead:
            self.global_symbol_combo.setCurrentText(lead)
            self.market_ticker_combo.setCurrentText(lead)
            self.val_ticker_combo.setCurrentText(lead)
            self.peer_ticker_combo.setCurrentText(lead)
            self.load_market_view()
        existing = parse_tickers(self.ticker_input.text())
        merged = list(dict.fromkeys(existing + [str(s).strip().upper() for s in selected if s]))
        self.ticker_input.setText(" ".join(merged))

    def _reload_nse_symbols(self) -> None:
        self.nse_symbol_rows = load_nse_symbol_rows()
        self.nse_symbols = [row["symbol"] for row in self.nse_symbol_rows]
        self.global_symbol_combo.blockSignals(True)
        self.global_symbol_combo.clear()
        self.global_symbol_combo.addItems(self.nse_symbols)
        self.global_symbol_combo.blockSignals(False)
        self._populate_ticker_combos()
        self._refresh_symbol_list()
        self._set_status(f"nse symbols reloaded | count={len(self.nse_symbol_rows)}")

    def _refresh_symbol_list(self) -> None:
        query = self.symbol_search.text().strip().upper() if hasattr(self, "symbol_search") else ""
        self.symbol_list.clear()
        shown = 0
        for row in self.nse_symbol_rows:
            sym = row.get("symbol", "")
            name = row.get("name", "")
            line = f"{sym} | {name}" if name else sym
            if query and query not in line.upper():
                continue
            item = QListWidgetItem(line)
            item.setData(Qt.UserRole, sym)
            item.setToolTip(name or sym)
            self.symbol_list.addItem(item)
            shown += 1
        self.symbol_count_label.setText(f"NSE Symbols: {shown}/{len(self.nse_symbol_rows)}")

    def _add_selected_symbols_to_input(self) -> None:
        selected = [x.data(Qt.UserRole) for x in self.symbol_list.selectedItems()]
        if not selected:
            QMessageBox.information(self, "NSE Symbols", "Select one or more symbols first.")
            return
        existing = parse_tickers(self.ticker_input.text())
        merged = list(dict.fromkeys(existing + selected))
        self.ticker_input.setText(" ".join(merged))
        self.tabs.setCurrentIndex(0)
        self._set_status(f"added {len(selected)} selected symbols to screener input")

    def _add_filtered_symbols_to_input(self) -> None:
        filtered = [self.symbol_list.item(i).data(Qt.UserRole) for i in range(self.symbol_list.count())]
        if not filtered:
            QMessageBox.information(self, "NSE Symbols", "No symbols in the current filter view.")
            return
        existing = parse_tickers(self.ticker_input.text())
        merged = list(dict.fromkeys(existing + filtered))
        self.ticker_input.setText(" ".join(merged))
        self.tabs.setCurrentIndex(0)
        self._set_status(f"added {len(filtered)} filtered symbols to screener input")

    def _build_rules_from_preset(self) -> list[Rule]:
        preset = self.preset_combo.currentText().strip()
        rules: list[Rule] = []
        specs = self.screener_presets.get(preset, {}).get("rules", []) if self.screener_presets else []
        for spec in specs:
            try:
                rules.append(Rule(str(spec["field"]), str(spec["op"]), float(spec["value"])))
            except Exception:
                continue
        # Always allow direct user overrides.
        rules.append(Rule("pe", "<=", self.max_pe_spin.value()))
        rules.append(Rule("roe_pct", ">=", self.min_roe_spin.value()))
        return rules

    def _on_market_symbol_changed(self, symbol: str) -> None:
        sym = symbol.strip().upper()
        if not sym:
            return
        if sym in self.nse_symbols:
            self.global_symbol_combo.setCurrentText(sym)
            self.val_ticker_combo.setCurrentText(sym)
            self.peer_ticker_combo.setCurrentText(sym)

    def _range_to_period(self, label: str) -> str:
        return {"1M": "1mo", "3M": "3mo", "6M": "6mo", "1Y": "1y"}.get(label, "1mo")

    def _populate_market_metrics(self, info: dict, last_close: float | None) -> None:
        metrics = [
            ("Current Price", _compact_currency(last_close if last_close is not None else info.get("currentPrice"))),
            ("Market Cap", _compact_currency(info.get("marketCap"))),
            ("P/E", _fmt_num(info.get("trailingPE"))),
            ("Forward P/E", _fmt_num(info.get("forwardPE"))),
            ("52W High", _fmt_num(info.get("fiftyTwoWeekHigh"))),
            ("52W Low", _fmt_num(info.get("fiftyTwoWeekLow"))),
            ("Day High", _fmt_num(info.get("dayHigh"))),
            ("Day Low", _fmt_num(info.get("dayLow"))),
            ("Volume", _fmt_num(info.get("volume"), digits=0)),
            ("Dividend Yield", _fmt_pct(info.get("dividendYield"))),
            ("Revenue Growth", _fmt_pct(info.get("revenueGrowth"))),
            ("ROE", _fmt_pct(info.get("returnOnEquity"))),
        ]
        self.market_metrics.setRowCount(len(metrics))
        self.market_metrics.setColumnCount(2)
        self.market_metrics.setHorizontalHeaderLabels(["Metric", "Value"])
        for i, (k, v) in enumerate(metrics):
            self.market_metrics.setItem(i, 0, QTableWidgetItem(k))
            self.market_metrics.setItem(i, 1, QTableWidgetItem(str(v)))
        self.market_metrics.horizontalHeader().setStretchLastSection(True)
        self.market_metrics.verticalHeader().setVisible(False)

    def _populate_quarterly_results(self, snapshot: dict) -> None:
        inc = snapshot.get("income_stmt")
        if not isinstance(inc, pd.DataFrame) or inc.empty:
            self.quarterly_results_table.setRowCount(1)
            self.quarterly_results_table.setColumnCount(1)
            self.quarterly_results_table.setHorizontalHeaderLabels(["Quarterly Results"])
            self.quarterly_results_table.setItem(0, 0, QTableWidgetItem("No quarterly data available."))
            return
        q = inc.iloc[:, :4].copy() if inc.shape[1] >= 4 else inc.copy()
        q = q.head(12)
        q.columns = [str(c.date()) if hasattr(c, "date") else str(c) for c in q.columns]
        self.quarterly_results_table.setRowCount(len(q.index))
        self.quarterly_results_table.setColumnCount(1 + len(q.columns))
        self.quarterly_results_table.setHorizontalHeaderLabels(["Metric"] + list(q.columns))
        for r, metric in enumerate(q.index):
            self.quarterly_results_table.setItem(r, 0, QTableWidgetItem(str(metric)))
            for c, col in enumerate(q.columns, start=1):
                val = q.loc[metric, col]
                self.quarterly_results_table.setItem(r, c, QTableWidgetItem(_fmt_num(val, 2)))
        self.quarterly_results_table.horizontalHeader().setStretchLastSection(True)
        self.quarterly_results_table.verticalHeader().setVisible(False)

    def _fetch_candles(self, symbol: str, period: str, interval: str) -> list[dict]:
        # Use Yahoo chart endpoint directly for more stable OHLC retrieval.
        s = requests.Session()
        s.trust_env = False
        s.headers.update({"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"})
        query_symbol = f"{symbol}.NS" if "." not in symbol else symbol
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{query_symbol}"
        resp = s.get(url, params={"range": period, "interval": interval}, timeout=20)
        if resp.status_code != 200:
            return []
        data = resp.json()
        result = (data.get("chart", {}).get("result") or [{}])[0]
        timestamps = result.get("timestamp") or []
        quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        volumes = quote.get("volume") or []
        out = []
        for t, o, h, l, c, v in zip(timestamps, opens, highs, lows, closes, volumes):
            if not all(isinstance(x, (int, float)) for x in (o, h, l, c)):
                continue
            out.append(
                {
                    "ts": int(t),
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                    "volume": float(v) if isinstance(v, (int, float)) else 0.0,
                }
            )
        return out

    def _render_price_chart(self, candles: list[dict], symbol: str, period: str, interval: str) -> None:
        self.price_chart.removeAllSeries()
        for ax in self.price_chart.axes():
            self.price_chart.removeAxis(ax)
        if not candles:
            self.price_chart.setTitle(f"{symbol}: No chart data")
            return

        candle_series = QCandlestickSeries()
        candle_series.setIncreasingColor(Qt.green)
        candle_series.setDecreasingColor(Qt.red)
        candle_series.setBodyWidth(0.72)
        vol_series = QLineSeries()
        vol_series.setColor(Qt.yellow)
        vol_series.setName("Volume")

        min_price = float("inf")
        max_price = float("-inf")
        max_vol = 0.0
        min_ts = candles[0]["ts"]
        max_ts = candles[-1]["ts"]

        for c in candles:
            set_ = QCandlestickSet(c["open"], c["high"], c["low"], c["close"], c["ts"] * 1000)
            candle_series.append(set_)
            vol_series.append(c["ts"] * 1000, c.get("volume", 0.0))
            min_price = min(min_price, c["low"])
            max_price = max(max_price, c["high"])
            max_vol = max(max_vol, c.get("volume", 0.0))

        self.price_chart.addSeries(candle_series)
        self.price_chart.addSeries(vol_series)
        x_axis = QDateTimeAxis()
        x_axis.setFormat("dd MMM")
        x_axis.setTitleText("Time")
        x_axis.setLabelsColor(Qt.lightGray)
        y_axis = QValueAxis()
        y_axis.setTitleText("Price (INR)")
        y_axis.setLabelFormat("%.2f")
        y_axis.setLabelsColor(Qt.lightGray)
        y_vol = QValueAxis()
        y_vol.setTitleText("Volume")
        y_vol.setLabelsColor(Qt.yellow)

        pad = (max_price - min_price) * 0.08 if max_price > min_price else max_price * 0.02
        y_axis.setRange(min_price - pad, max_price + pad)
        y_vol.setRange(0.0, max_vol * 1.15 if max_vol > 0 else 1.0)

        x_axis.setRange(QDateTime.fromSecsSinceEpoch(min_ts), QDateTime.fromSecsSinceEpoch(max_ts))
        self.price_chart.addAxis(x_axis, Qt.AlignBottom)
        self.price_chart.addAxis(y_axis, Qt.AlignLeft)
        self.price_chart.addAxis(y_vol, Qt.AlignRight)
        candle_series.attachAxis(x_axis)
        candle_series.attachAxis(y_axis)
        vol_series.attachAxis(x_axis)
        vol_series.attachAxis(y_vol)
        last = candles[-1]
        first_close = candles[0]["close"]
        last_close = last["close"]
        chg = ((last_close / first_close) - 1) * 100 if first_close else 0.0
        self.price_chart.setTitle(
            f"{symbol} {period}/{interval}  O:{last['open']:.2f} H:{last['high']:.2f} "
            f"L:{last['low']:.2f} C:{last_close:.2f} Vol:{last.get('volume',0):,.0f}  Δ {chg:+.2f}%"
        )
        self.price_chart.legend().hide()

    def load_market_view(self) -> None:
        symbol = self.market_ticker_combo.currentText().strip().upper()
        if not symbol:
            return
        self._set_status(f"loading market view -> {symbol}")
        QApplication.processEvents()
        fetcher = MarketDataFetcher()
        try:
            snapshot = fetcher.fetch_fundamental_snapshot(symbol)
            period = self._range_to_period(self.market_range_combo.currentText())
            interval = self.market_interval_combo.currentText()
            hist = fetcher.fetch_history(symbol, period=period, interval=interval)
            candles = self._fetch_candles(symbol, period, interval)
            if not candles and interval != "1d":
                candles = self._fetch_candles(symbol, period, "1d")
        except Exception as exc:
            QMessageBox.critical(self, "Market View Error", f"{exc}\n\nTip: retry with interval=1d")
            self._set_status(f"market view failed -> {symbol}")
            return

        info = snapshot.get("info", {}) or {}
        last_close = None
        if isinstance(hist, pd.DataFrame) and not hist.empty and "Close" in hist.columns:
            last_close = float(hist["Close"].dropna().iloc[-1]) if not hist["Close"].dropna().empty else None
        if last_close is None and candles:
            last_close = float(candles[-1]["close"])

        summary_lines = [
            f"Symbol: {symbol}",
            f"Company: {info.get('longName') or info.get('shortName') or 'N/A'}",
            f"Sector: {info.get('sector') or 'N/A'}",
            f"Industry: {info.get('industry') or 'N/A'}",
            f"Website: {info.get('website') or 'N/A'}",
            f"Business Summary: {info.get('longBusinessSummary') or 'N/A'}",
        ]
        self.company_summary.setPlainText("\n".join(summary_lines))
        self._populate_market_metrics(info, last_close)
        self._populate_quarterly_results(snapshot)
        self._render_price_chart(candles, symbol, period, interval)
        self._set_status(f"market view loaded -> {symbol}")

    def _apply_theme(self) -> None:
        self.setStyleSheet(
            """
            QWidget { background: #080a0d; color: #f3f4f6; font-family: Consolas; font-size: 12px; }
            QFrame#TopStrip { background: #121418; border: 1px solid #f0b90b; }
            QLabel#TopStripLabel { color: #f0b90b; font-size: 11px; font-weight: 700; }
            QLabel#Status { color: #ffbf47; font-weight: 700; }
            QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QDateEdit, QTextEdit, QTableWidget, QListWidget, QTabWidget::pane {
                background: #111318; border: 1px solid #2f3640; border-radius: 0px; padding: 4px;
            }
            QPushButton {
                background: #1b1f27; color: #f0b90b; border: 1px solid #f0b90b; border-radius: 0px;
                padding: 6px 10px; font-weight: 600;
            }
            QPushButton:hover { background: #252b36; }
            QPushButton:pressed { background: #313847; }
            QHeaderView::section {
                background: #0f1218; color: #f0b90b; border: 1px solid #2c3240; padding: 4px; font-weight: 700;
            }
            QTabBar::tab { background: #13161d; color: #aeb7c2; padding: 8px 12px; border: 1px solid #2c3240; }
            QTabBar::tab:selected { background: #1e2531; color: #f0b90b; border-top: 2px solid #f0b90b; }
            QTableWidget { gridline-color: #2a313c; selection-background-color: #1f3858; alternate-background-color: #0c1015; }
            QListWidget::item:selected { background: #1f3858; color: #ffffff; }
            """
        )

    def _set_status(self, text: str) -> None:
        self.status_label.setText(f"STATUS: {text.upper()}")

    def _style_tables(self) -> None:
        tables = [
            self.screener_table,
            self.market_metrics,
            self.quarterly_results_table,
            self.val_projection_table,
            self.val_scenarios_table,
            self.val_sensitivity_table,
            self.peer_table,
            self.bt_holdings_table,
            self.alerts_table,
        ]
        for table in tables:
            table.setAlternatingRowColors(True)
            table.setSelectionBehavior(QAbstractItemView.SelectRows)
            table.setSelectionMode(QAbstractItemView.SingleSelection)
            table.setSortingEnabled(True)
        if hasattr(self, "symbol_list"):
            self.symbol_list.setAlternatingRowColors(True)

    def _update_clock(self) -> None:
        now = QDateTime.currentDateTime().toString("dd MMM yyyy HH:mm:ss")
        self.clock_label.setText(f"LOCAL {now}")

    def _update_market_tape(self) -> None:
        if self.df.empty or "ticker" not in self.df.columns:
            self.market_tape_label.setText("TAPE: WAITING FOR DATA")
            return
        cols = [c for c in ("ticker", "current_price", "rev_growth_pct", "roe_pct") if c in self.df.columns]
        if not cols or "ticker" not in cols:
            self.market_tape_label.setText("TAPE: DATA LOADED")
            return
        view = self.df[cols].head(5).copy().fillna("")
        parts: list[str] = []
        for _, row in view.iterrows():
            t = str(row.get("ticker", ""))
            p = row.get("current_price")
            g = row.get("rev_growth_pct")
            r = row.get("roe_pct")
            p_txt = f"{float(p):.2f}" if isinstance(p, (int, float)) else "N/A"
            g_txt = f"{float(g):+.1f}%" if isinstance(g, (int, float)) else "N/A"
            r_txt = f"{float(r):.1f}%" if isinstance(r, (int, float)) else "N/A"
            parts.append(f"{t} PX:{p_txt} REV:{g_txt} ROE:{r_txt}")
        tape = " | ".join(parts) if parts else "DATA LOADED"
        self.market_tape_label.setText(f"TAPE: {tape}")

    def _execute_terminal_command(self) -> None:
        cmd = self.command_line.text().strip().upper()
        mapping = {
            "SCREENER": 0,
            "MARKET": 1,
            "MARKET VIEW": 1,
            "VALUATION": 2,
            "PEERS": 3,
            "BACKTEST": 4,
            "ALERTS": 5,
            "SYMBOLS": 6,
            "PEER": 3,
            "BACKTESTING": 4,
            "ALERT": 5,
            "NSE": 6,
            "NSE SYMBOLS": 6,
        }
        if cmd in mapping:
            self.tabs.setCurrentIndex(mapping[cmd])
            self._set_status(f"command accepted -> {cmd}")
        else:
            self._set_status("unknown command")

    def _set_table_from_df(self, table: QTableWidget, df: pd.DataFrame, max_rows: int = 500) -> None:
        if df is None or df.empty:
            table.clear()
            table.setRowCount(0)
            table.setColumnCount(0)
            return
        view = df.head(max_rows).copy()
        view = view.fillna("")
        table.setRowCount(len(view))
        table.setColumnCount(len(view.columns))
        table.setHorizontalHeaderLabels([str(c) for c in view.columns])
        for r, (_, row) in enumerate(view.iterrows()):
            for c, val in enumerate(row.tolist()):
                table.setItem(r, c, QTableWidgetItem(str(val)))
        table.resizeColumnsToContents()

    def _refresh_ticker_dependent_controls(self) -> None:
        self._populate_ticker_combos()

        self.alert_field.clear()
        if not self.df.empty:
            numeric_cols = [c for c in self.df.columns if pd.api.types.is_numeric_dtype(self.df[c])]
            self.alert_field.addItems(numeric_cols)

    def run_screener(self) -> None:
        tickers = parse_tickers(self.ticker_input.text())
        if not tickers:
            QMessageBox.warning(self, "Input Error", "Please provide at least one ticker.")
            return

        self._set_status("Fetching data and running screener...")
        QApplication.processEvents()
        fetcher = MarketDataFetcher()
        rows = []
        for t in tickers:
            try:
                snap = fetcher.fetch_fundamental_snapshot(t)
                rows.append(compute_ratios(normalize_snapshot(snap)))
            except Exception as exc:
                rows.append({"ticker": t, "error": str(exc)})
        self.df = pd.DataFrame(rows)

        rules = self._build_rules_from_preset()

        engine = ScreenerEngine(self.df)
        screened = engine.apply_rules(rules)
        ranked = engine.rank(screened, by="roe_pct", ascending=False, top_n=self.top_n_spin.value())
        self._set_table_from_df(self.screener_table, ranked)
        self._refresh_ticker_dependent_controls()
        if not ranked.empty and "ticker" in ranked.columns:
            lead = str(ranked["ticker"].iloc[0]).strip().upper()
            if lead:
                self.market_ticker_combo.setCurrentText(lead)
                self.load_market_view()
        self._update_market_tape()
        self._set_status(f"Done | Universe={len(self.df)} | Matched={len(screened)} | Showing={len(ranked)}")

    def run_valuation(self) -> None:
        if self.df.empty:
            QMessageBox.information(self, "Valuation", "Run screener first to load data.")
            return
        ticker = self.val_ticker_combo.currentText().strip().upper()
        if not ticker:
            QMessageBox.information(self, "Valuation", "Select a ticker.")
            return
        row_df = self.df[self.df["ticker"] == ticker]
        if row_df.empty:
            QMessageBox.warning(self, "Valuation", "Selected ticker not found in current dataset.")
            return
        row = row_df.iloc[0]

        revenue = _safe_float(row.get("revenue_ttm"), 0.0)
        net_margin = _safe_float(row.get("profit_margin"), 0.08)
        base_fcf = revenue * net_margin if revenue > 0 else _safe_float(row.get("market_cap"), 0.0) * 0.03
        current_price = _safe_float(row.get("current_price"), 0.0)
        market_cap = _safe_float(row.get("market_cap"), 0.0)
        shares = (market_cap / current_price) if current_price > 0 else None
        net_debt = _safe_float(row.get("net_debt"), 0.0)

        try:
            dcf = multi_stage_fcff_dcf(
                DcfInputs(
                    base_fcf=base_fcf,
                    stages=[
                        DcfStage(
                            years=self.val_years.value(),
                            growth_rate=self.val_growth.value() / 100.0,
                            discount_rate=self.val_discount.value() / 100.0,
                        )
                    ],
                    terminal_growth=self.val_terminal.value() / 100.0,
                    net_debt=net_debt,
                    shares_outstanding=shares,
                )
            )
        except Exception as exc:
            QMessageBox.critical(self, "Valuation Error", str(exc))
            return

        intrinsic = dcf["per_share_value"]
        upside = ((intrinsic / current_price) - 1.0) * 100 if intrinsic is not None and current_price > 0 else None
        self.val_metrics.setText(
            "Enterprise: {0:,.0f} | Equity: {1:,.0f} | Intrinsic/Share: {2} | Upside: {3}".format(
                dcf["enterprise_value"],
                dcf["equity_value"],
                "N/A" if intrinsic is None else f"{intrinsic:.2f}",
                "N/A" if upside is None else f"{upside:+.2f}%",
            )
        )
        self._set_table_from_df(self.val_projection_table, dcf["projection_df"])

        scenarios = run_dcf_scenarios(
            base_fcf=base_fcf,
            years=self.val_years.value(),
            net_debt=net_debt,
            shares_outstanding=shares,
            bull=(0.14, 0.10, 0.045),
            base=(self.val_growth.value() / 100.0, self.val_discount.value() / 100.0, self.val_terminal.value() / 100.0),
            bear=(0.05, 0.14, 0.03),
        )
        self._set_table_from_df(self.val_scenarios_table, scenarios)

        disc = self.val_discount.value() / 100.0
        tg = self.val_terminal.value() / 100.0
        sensitivity = build_sensitivity_table(
            base_fcf=base_fcf,
            years=self.val_years.value(),
            growth_rate=self.val_growth.value() / 100.0,
            discount_rates=[max(disc + x, 0.02) for x in (-0.02, -0.01, 0.0, 0.01, 0.02)],
            terminal_growth_rates=[max(tg + x, 0.0) for x in (-0.01, -0.005, 0.0, 0.005, 0.01)],
            net_debt=net_debt,
            shares_outstanding=shares,
        )
        self._set_table_from_df(self.val_sensitivity_table, sensitivity)

        if market_cap > 0:
            implied = reverse_dcf_implied_growth(
                target_equity_value=market_cap,
                base_fcf=base_fcf,
                years=self.val_years.value(),
                discount_rate=disc,
                terminal_growth=tg,
                net_debt=net_debt,
            )
            if implied is not None:
                self._set_status(f"Valuation done | Reverse DCF implied growth={implied * 100:.2f}%")
                return
        self._set_status("Valuation done")

    def run_peers(self) -> None:
        if self.df.empty:
            QMessageBox.information(self, "Peers", "Run screener first to load data.")
            return
        ticker = self.peer_ticker_combo.currentText().strip().upper()
        if not ticker:
            QMessageBox.information(self, "Peers", "Select a ticker.")
            return
        peer_df = build_peer_comparison(self.df, ticker)
        self._set_table_from_df(self.peer_table, peer_df)
        self._set_status(f"Peer comparison done for {ticker}")

    def run_backtest(self) -> None:
        if self.df.empty or "ticker" not in self.df.columns:
            QMessageBox.information(self, "Backtest", "Run screener first to load data.")
            return
        tickers = sorted(self.df["ticker"].dropna().astype(str).unique().tolist())
        if not tickers:
            QMessageBox.information(self, "Backtest", "No valid tickers for backtest.")
            return
        self._set_status("Running backtest...")
        QApplication.processEvents()

        try:
            result = backtest_momentum_rotation(
                tickers=tickers,
                start=self.bt_start.date().toString("yyyy-MM-dd"),
                end=self.bt_end.date().toString("yyyy-MM-dd"),
                config=BacktestConfig(
                    lookback_days=self.bt_lookback.value(),
                    rebalance_freq=self.bt_rebalance.currentText(),
                    top_n=self.bt_topn.value(),
                    transaction_cost_bps=self.bt_cost.value(),
                    benchmark=self.bt_bench.text().strip() or "^NSEI",
                ),
            )
        except Exception as exc:
            QMessageBox.critical(self, "Backtest Error", str(exc))
            return

        self.latest_backtest = result
        s = result["summary"]["strategy"]
        b = result["summary"]["benchmark"]
        alpha = result["summary"]["alpha_total_return"]
        self.bt_summary.setText(
            f"Strategy TR={s['total_return']*100:.2f}% | CAGR={s['cagr']*100:.2f}% | "
            f"Sharpe={s['sharpe']:.2f} | MDD={s['max_drawdown']*100:.2f}% | "
            f"Benchmark CAGR={b['cagr']*100:.2f}% | Alpha={alpha*100:.2f}%"
        )
        self._set_table_from_df(self.bt_holdings_table, result["holdings"])
        self._set_status("Backtest done")

    def run_alerts(self) -> None:
        if self.df.empty:
            QMessageBox.information(self, "Alerts", "Run screener first to load data.")
            return
        field = self.alert_field.currentText()
        if not field:
            QMessageBox.warning(self, "Alerts", "No numeric field available.")
            return
        rule = AlertRule(
            name=self.alert_name.text().strip() or "Custom Alert",
            field=field,
            op=self.alert_op.currentText(),
            threshold=self.alert_threshold.value(),
            severity=self.alert_sev.currentText(),
        )
        alerts = evaluate_alert_rule(self.df, rule)
        self.latest_alerts = alerts
        self._set_table_from_df(self.alerts_table, alerts)
        self._set_status(f"Alert check done | Triggered={len(alerts)}")
        self.refresh_alert_history()

    def save_alerts_log(self) -> None:
        if self.latest_alerts is None or self.latest_alerts.empty:
            QMessageBox.information(self, "Alerts", "No triggered alerts to save.")
            return
        append_alert_log(self.latest_alerts, ALERT_LOG_PATH)
        self._set_status(f"Alerts appended to log: {ALERT_LOG_PATH}")
        self.refresh_alert_history()

    def refresh_alert_history(self) -> None:
        if not ALERT_LOG_PATH.exists():
            self.alert_history.setPlainText("No alert log yet.")
            return
        try:
            hist = pd.read_csv(ALERT_LOG_PATH).tail(200)
            self.alert_history.setPlainText(hist.to_string(index=False))
        except Exception as exc:
            self.alert_history.setPlainText(f"Could not read alert log: {exc}")

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key_F1:
            self.tabs.setCurrentIndex(0)
            return
        if event.key() == Qt.Key_F2:
            self.tabs.setCurrentIndex(1)
            return
        if event.key() == Qt.Key_F3:
            self.tabs.setCurrentIndex(2)
            return
        if event.key() == Qt.Key_F4:
            self.tabs.setCurrentIndex(3)
            return
        if event.key() == Qt.Key_F5:
            self.tabs.setCurrentIndex(4)
            return
        if event.key() == Qt.Key_F6:
            self.tabs.setCurrentIndex(5)
            return
        if event.key() == Qt.Key_F7:
            self.tabs.setCurrentIndex(6)
            return
        if event.key() == Qt.Key_Escape and self.isFullScreen():
            self.showMaximized()
            return
        super().keyPressEvent(event)


def main() -> None:
    app = QApplication(sys.argv)
    win = FundamentalWindow()
    win.showFullScreen()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
