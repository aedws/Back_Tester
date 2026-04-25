/**
 * Map a stock symbol to a publicly-hosted company logo URL.
 *
 * Strategy:
 *   - **US tickers**: financialmodelingprep's image CDN serves a square logo
 *     keyed directly by ticker (`/image-stock/{TICKER}.png`). No API key
 *     required, hot-linkable, and they have very broad coverage including
 *     ETFs.
 *   - **KR / other**: ticker → company website domain table, fed into
 *     Clearbit Logo API (`logo.clearbit.com/{domain}`). Clearbit is free
 *     for hot-linking and crops/scales the logo automatically.
 *
 * If we don't have a mapping (or the upstream returns 404), the consuming
 * component falls back to a colored initial-block — see `<CompanyLogo />`
 * inside `EarningsBar.tsx`.
 */

const KR_DOMAIN_MAP: Record<string, string> = {
  "005930.KS": "samsung.com",
  "000660.KS": "skhynix.com",
  "005380.KS": "hyundai.com",
};

const FMP_BASE = "https://financialmodelingprep.com/image-stock";
const CLEARBIT_BASE = "https://logo.clearbit.com";

export function getCompanyLogoUrl(symbol: string): string | null {
  if (!symbol) return null;
  const trimmed = symbol.trim();
  if (KR_DOMAIN_MAP[trimmed]) {
    return `${CLEARBIT_BASE}/${KR_DOMAIN_MAP[trimmed]}`;
  }
  // Plain US ticker (no exchange suffix).
  if (!trimmed.includes(".")) {
    return `${FMP_BASE}/${trimmed.toUpperCase()}.png`;
  }
  // Other-region tickers (.L, .T, .HK, ...): no reliable free logo source.
  return null;
}
