/**
 * Korean (KOSPI / KOSDAQ) earnings watchlist.
 *
 * Yahoo Finance does not expose Korean earnings via its public calendar
 * endpoint, so we instead poll `quoteSummary({ calendarEvents })` for the
 * tickers in this list and keep the ones whose `earningsDate` falls inside
 * our requested window.
 *
 * Per the user request we only track the three names that materially move
 * the Korean market; expanding this list is cheap (a few extra HTTP calls
 * once a week) but yields a lot of low-signal noise.
 */

export interface KrTicker {
  symbol: string;
  name: string;
}

export const KR_EARNINGS_WATCHLIST: KrTicker[] = [
  { symbol: "005930.KS", name: "삼성전자" },
  { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "005380.KS", name: "현대차" },
];
