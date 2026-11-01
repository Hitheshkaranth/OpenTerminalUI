/** Verified official identities supplement optional provider metadata.
 * Assets are bundled for reliable rendering; every addition needs an official source.
 * Country-qualified keys prevent ticker collisions across markets.
 */
type VerifiedIdentity = {
  company_name: string; exchange: string; logo_url: string; website: string;
  logo_source: string;
};
export const companyIdentities: Readonly<Record<string, VerifiedIdentity>> = {
  "US:AAPL": {
    company_name: "Apple Inc.", exchange: "NASDAQ", logo_url: "/company-logos/apple.ico",
    website: "https://www.apple.com", logo_source: "https://www.apple.com/favicon.ico",
  },
  "IN:MTARTECH": {
    company_name: "MTAR Technologies Limited", exchange: "NSE", logo_url: "/company-logos/mtar.png",
    website: "https://mtar.in", logo_source: "https://mtar.in/wp-content/uploads/2025/07/cropped-cropped-MTAR-Logo-icon-180x180-1-192x192.png",
  },
};
