export interface MarketTicker {
  symbol: string;
  label: string;
  group: "fx" | "us" | "kr" | "commodity";
}

// Display order is preserved.
export const MARKET_TICKERS: ReadonlyArray<MarketTicker> = [
  { symbol: "KRW=X", label: "USD/KRW", group: "fx" },
  { symbol: "DX-Y.NYB", label: "달러 인덱스", group: "fx" },
  { symbol: "^IXIC", label: "나스닥", group: "us" },
  { symbol: "NQ=F", label: "나스닥 100 선물", group: "us" },
  { symbol: "^GSPC", label: "S&P 500", group: "us" },
  { symbol: "^DJI", label: "다우존스", group: "us" },
  { symbol: "^SOX", label: "필라델피아 반도체", group: "us" },
  { symbol: "^VIX", label: "VIX", group: "us" },
  { symbol: "^KS11", label: "코스피", group: "kr" },
  { symbol: "^KQ11", label: "코스닥", group: "kr" },
  { symbol: "CL=F", label: "WTI 원유", group: "commodity" },
];
