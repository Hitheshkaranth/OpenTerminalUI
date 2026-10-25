import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/base";

type CompanyProfile = { company_name?: string; exchange?: string; sector?: string; industry?: string; logo_url?: string; website?: string; provenance?: { quality?: string } };
// A verified local identity keeps the featured company recognizable offline.
const identities: Record<string, CompanyProfile> = {
  "US:AAPL": { company_name: "Apple Inc.", exchange: "NASDAQ", logo_url: "/company-logos/apple.ico", website: "https://www.apple.com" },
};
export function companyAssetUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/company-logos/") && !value.includes("..")) return value;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}

function CompanyMark({ symbol, name, src, compact }: { symbol: string; name: string; src?: string; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`company-mark${compact ? " company-mark--small" : ""}${src && !failed ? " company-mark--image" : ""}`}>
    {src && !failed ? <img src={src} alt={`${name} logo`} width={compact ? 28 : 56} height={compact ? 28 : 56} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <span aria-label={`${symbol} company initials`}>{symbol.slice(0, 3)}</span>}
  </span>;
}

export function CompanyIdentity({ symbol, market, compact = false }: { symbol: string; market: string; compact?: boolean }) {
  const ticker = symbol.trim().toUpperCase();
  const country = ["US", "NASDAQ", "NYSE", "AMEX"].includes(market.toUpperCase()) ? "US" : ["IN", "NSE", "BSE"].includes(market.toUpperCase()) ? "IN" : market.toUpperCase();
  const local = identities[`${country}:${ticker}`];
  const profile = useQuery({
    queryKey: ["company-identity", country, ticker],
    queryFn: async () => (await api.get<CompanyProfile>(`/stocks/${encodeURIComponent(ticker)}`, { params: { market: country }, timeout: 12000 })).data,
    enabled: !compact && Boolean(ticker), staleTime: 30 * 60 * 1000, retry: false,
  });
  // Compact instances share cached metadata without creating one request per dossier.
  const data = profile.data?.provenance?.quality === "synthetic" ? undefined : profile.data;
  const name = local?.company_name || data?.company_name || ticker;
  const logo = companyAssetUrl(local?.logo_url) || companyAssetUrl(data?.logo_url);
  const exchange = local?.exchange || data?.exchange;
  const sector = data?.sector || data?.industry;
  const website = companyAssetUrl(local?.website || data?.website);
  return <span className={`company-identity${compact ? " company-identity--compact" : ""}`}>
    <CompanyMark key={`${country}:${ticker}:${logo}`} symbol={ticker} name={name} src={logo} compact={compact} />
    <span className="company-identity-copy">
      <span className="company-identity-name">{name}</span>
      <span className="company-identity-details"><span>{ticker}</span>{!compact && <><span>{exchange || (country === "US" ? "United States" : country === "IN" ? "India" : country)}</span>{sector && <span>{sector}</span>}</>}</span>
      {!compact && <span className="company-identity-links"><Link to={`/equity/security/${encodeURIComponent(ticker)}`}>Company overview <span aria-hidden="true">↗</span></Link>{website && <a href={website} target="_blank" rel="noreferrer">Company website <span aria-hidden="true">↗</span></a>}</span>}
    </span>
  </span>;
}
