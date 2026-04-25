/**
 * Korean (KOSPI / KOSDAQ) earnings watchlist.
 *
 * Yahoo Finance does not expose Korean earnings via its public calendar
 * endpoint, so we instead poll `quoteSummary({ calendarEvents })` for the
 * tickers in this list and keep the ones whose `earningsDate` falls inside
 * our requested window.
 *
 * Coverage targets the top of KOSPI by market cap plus a handful of widely
 * traded KOSDAQ names — these account for the overwhelming majority of
 * earnings interest among Korean retail investors. Add more freely; the
 * fetcher caps total parallel requests internally.
 */

export interface KrTicker {
  symbol: string;
  name: string;
}

export const KR_EARNINGS_WATCHLIST: KrTicker[] = [
  // ─── KOSPI top names ────────────────────────────────────────────────
  { symbol: "005930.KS", name: "삼성전자" },
  { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "373220.KS", name: "LG에너지솔루션" },
  { symbol: "207940.KS", name: "삼성바이오로직스" },
  { symbol: "005380.KS", name: "현대차" },
  { symbol: "005935.KS", name: "삼성전자우" },
  { symbol: "068270.KS", name: "셀트리온" },
  { symbol: "035420.KS", name: "NAVER" },
  { symbol: "005490.KS", name: "POSCO홀딩스" },
  { symbol: "051910.KS", name: "LG화학" },
  { symbol: "035720.KS", name: "카카오" },
  { symbol: "012330.KS", name: "현대모비스" },
  { symbol: "028260.KS", name: "삼성물산" },
  { symbol: "105560.KS", name: "KB금융" },
  { symbol: "055550.KS", name: "신한지주" },
  { symbol: "086790.KS", name: "하나금융지주" },
  { symbol: "138040.KS", name: "메리츠금융지주" },
  { symbol: "003670.KS", name: "포스코퓨처엠" },
  { symbol: "015760.KS", name: "한국전력" },
  { symbol: "032830.KS", name: "삼성생명" },
  { symbol: "066570.KS", name: "LG전자" },
  { symbol: "000270.KS", name: "기아" },
  { symbol: "017670.KS", name: "SK텔레콤" },
  { symbol: "030200.KS", name: "KT" },
  { symbol: "009150.KS", name: "삼성전기" },
  { symbol: "011200.KS", name: "HMM" },
  { symbol: "010130.KS", name: "고려아연" },
  { symbol: "010950.KS", name: "S-Oil" },
  { symbol: "096770.KS", name: "SK이노베이션" },
  { symbol: "316140.KS", name: "우리금융지주" },
  { symbol: "024110.KS", name: "기업은행" },
  { symbol: "034730.KS", name: "SK" },
  { symbol: "352820.KS", name: "하이브" },
  { symbol: "003550.KS", name: "LG" },
  { symbol: "018260.KS", name: "삼성에스디에스" },
  { symbol: "011170.KS", name: "롯데케미칼" },
  { symbol: "032640.KS", name: "LG유플러스" },
  { symbol: "047810.KS", name: "한국항공우주" },
  { symbol: "009540.KS", name: "HD한국조선해양" },
  { symbol: "329180.KS", name: "HD현대중공업" },
  { symbol: "010140.KS", name: "삼성중공업" },
  { symbol: "402340.KS", name: "SK스퀘어" },
  { symbol: "035250.KS", name: "강원랜드" },
  { symbol: "323410.KS", name: "카카오뱅크" },
  { symbol: "377300.KS", name: "카카오페이" },
  { symbol: "267260.KS", name: "HD현대일렉트릭" },
  { symbol: "267250.KS", name: "HD현대" },
  { symbol: "036570.KS", name: "엔씨소프트" },
  { symbol: "251270.KS", name: "넷마블" },
  { symbol: "097950.KS", name: "CJ제일제당" },
  { symbol: "271560.KS", name: "오리온" },
  { symbol: "282330.KS", name: "BGF리테일" },
  { symbol: "139480.KS", name: "이마트" },
  { symbol: "023530.KS", name: "롯데쇼핑" },
  { symbol: "004020.KS", name: "현대제철" },
  { symbol: "078930.KS", name: "GS" },
  { symbol: "090430.KS", name: "아모레퍼시픽" },
  { symbol: "051900.KS", name: "LG생활건강" },
  { symbol: "000810.KS", name: "삼성화재" },
  { symbol: "000720.KS", name: "현대건설" },

  // ─── KOSDAQ majors ──────────────────────────────────────────────────
  { symbol: "247540.KQ", name: "에코프로비엠" },
  { symbol: "086520.KQ", name: "에코프로" },
  { symbol: "091990.KQ", name: "셀트리온헬스케어" },
  { symbol: "196170.KQ", name: "알테오젠" },
  { symbol: "277810.KQ", name: "레인보우로보틱스" },
  { symbol: "263750.KQ", name: "펄어비스" },
  { symbol: "213420.KQ", name: "덕산네오룩스" },
  { symbol: "122870.KQ", name: "와이지엔터테인먼트" },
  { symbol: "035900.KQ", name: "JYP Ent." },
  { symbol: "041510.KQ", name: "에스엠" },
  { symbol: "058470.KQ", name: "리노공업" },
  { symbol: "240810.KQ", name: "원익IPS" },
  { symbol: "095340.KQ", name: "ISC" },
  { symbol: "066970.KQ", name: "엘앤에프" },
  { symbol: "112040.KQ", name: "위메이드" },
  { symbol: "293490.KQ", name: "카카오게임즈" },
  { symbol: "067310.KQ", name: "하나마이크론" },
  { symbol: "039030.KQ", name: "이오테크닉스" },
  { symbol: "357780.KQ", name: "솔브레인" },
  { symbol: "278280.KQ", name: "천보" },
  { symbol: "214150.KQ", name: "클래시스" },
];
