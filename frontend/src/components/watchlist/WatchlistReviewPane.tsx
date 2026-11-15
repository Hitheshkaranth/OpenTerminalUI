import { useSettingsStore } from "../../store/settingsStore";
import type { MarketCode } from "../../types/markets";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import { PriceOverviewChart } from "../security/PriceOverviewChart";
import { InstrumentNotesPanel } from "./InstrumentNotesPanel";
import { reviewInstrument } from "./reviewInstrument";
import "./WatchlistReview.css";

export type ReviewQuote = { ltp?: number; change_pct?: number; volume?: number | null; ts?: string; market?: string; source?: string; currency?: string; timestamp_source?: string };
type Props = { symbol: string; market: string; quote: ReviewQuote; index: number; count: number; loading: boolean; error: boolean; onPrevious: () => void; onNext: () => void };

function number(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "Unavailable";
}

export function WatchlistReviewPane({ symbol, market, quote, index, count, loading, error, onPrevious, onNext }: Props) {
  const instrument = reviewInstrument(symbol, quote.market || market);
  const timestamp = quote.ts ? new Date(quote.ts) : null;
  const hasTimestamp = timestamp && Number.isFinite(timestamp.getTime());
  return <aside id="watchlist-selected-preview" tabIndex={-1} className="watchlist-review-pane" aria-label={`Review ${symbol}`}>
    <header className="watchlist-review-heading">
      <div><p className="watchlist-review-kicker">Selected instrument</p><h2>{symbol}</h2><p>{instrument.label} · {instrument.market}</p></div>
      <div className="watchlist-review-stepper"><span>{index + 1} of {count}</span><button type="button" aria-label="Review previous symbol" disabled={index <= 0} onClick={onPrevious}><ArrowUp size={16} /></button><button type="button" aria-label="Review next symbol" disabled={index >= count - 1} onClick={onNext}><ArrowDown size={16} /></button></div>
    </header>
    <div className="watchlist-review-quote" aria-busy={loading}>
      <div><span>Last price · {quote.currency || "currency not reported"}</span><strong>{loading && quote.ltp == null ? "Loading…" : number(quote.ltp)}</strong></div>
      <div><span>Snapshot change</span><strong>{quote.change_pct == null ? "Unavailable" : `${number(quote.change_pct)}%`}</strong></div>
      <div><span>Volume</span><strong>{number(quote.volume, 0)}</strong></div>
    </div>
    <p className="watchlist-review-provenance">{quote.source || "Quote unavailable"}{hasTimestamp ? <> · {quote.timestamp_source === "reported" || quote.timestamp_source === "stream" ? "Feed time" : quote.timestamp_source === "retrieved" ? "Retrieved" : "Feed timestamp"} <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString()}</time></> : " · Timestamp unavailable"}. Times may reflect retrieval; feed status alone does not establish freshness.</p>
    {error && <p role="status" className="watchlist-review-notice">Some quote requests failed. Available snapshots remain visible; coverage may be incomplete.</p>}
    {instrument.kind === "index" && <p className="watchlist-review-notice">This chart shows the underlying index. It is not the price or history of a dated futures contract.</p>}
    <div className="watchlist-review-chart" aria-label={`${symbol} price history`}>{instrument.chartAvailable === false ? <p className="watchlist-review-notice">Price history in this quote currency is unavailable here. The pair is not substituted with a USD pair.</p> : <PriceOverviewChart key={`${instrument.market}:${instrument.chartSymbol}`} symbol={instrument.chartSymbol} market={instrument.market} height={220} />}</div>
    <nav className="watchlist-review-actions" aria-label={`${symbol} research actions`}>
      <Link to={instrument.primaryPath}>{instrument.primaryLabel}<ArrowUpRight size={14} /></Link>
      {instrument.kind === "equity" && <><Link to={`${instrument.primaryPath}&tab=news`}>Read news</Link><Link to={`/equity/research-dossiers?ticker=${encodeURIComponent(symbol)}`}>Research dossiers</Link></>}
      {instrument.kind === "equity" && <Link to={`/equity/alerts?ticker=${encodeURIComponent(instrument.chartSymbol)}`} onClick={() => { if (["NSE", "BSE", "NASDAQ", "NYSE"].includes(instrument.market)) useSettingsStore.getState().setSelectedMarket(instrument.market as MarketCode); }}>Manage alerts</Link>}
    </nav>
    <InstrumentNotesPanel symbol={symbol} />
  </aside>;
}
