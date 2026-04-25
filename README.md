# 미장 티커 DCA 백테스터 (Vercel 배포용)

미국 상장 티커를 대상으로 **상장일부터** 또는 **N년 단위**로 DCA(적립식 매수) 백테스트를
돌려주는 Next.js 14 앱입니다. Vercel에 그대로 올라가도록 구성돼 있습니다.

- **Frontend**: Next.js (App Router) · TypeScript · Tailwind CSS · Recharts
- **Data**: [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) (Yahoo Finance, 배당/분할 자동 조정)
- **API**: `app/api/backtest/route.ts` — Node 런타임 서버리스 함수
- **Backtest 엔진**: `lib/backtest.ts` (순수 TS, IRR(XIRR)·MDD·CAGR·Lump-sum 비교 포함)

## 주요 기능

- **모드 분리** (홈 상단 탭, 새로고침해도 마지막 모드 기억):
  - **DCA 백테스터** — 장기 적립식 시뮬레이션 (IRR · MDD · 벤치마크 · 분배금 분석)
  - **스윙 · 데이 트레이드** — 티커 검색 + 단기 차트 가이드 (스윙 60m / 데이 5m, ATR 손절·익절선)
- **자체 합성 Fear & Greed 지수** — VIX/50d MA, S&P500 vs 125d MA, 52주 위치, HYG−LQD 20일,
  SPY−TLT 20일 다섯 개 지표를 0~100 스코어로 정규화 → 가중평균. 반원 게이지 + 구성요소
  막대 + 5분 캐시 + 자동 갱신. 두 모드 공통 상단 노출 (CNN 지수와는 데이터 소스가 달라
  절대값보다 *추세*를 참고)
- **과거 진입 분포** — 백테스트 결과에 *상장 이래 모든 시작점*에서 같은 DCA를 슬라이딩
  (월 단위)으로 시뮬레이션한 IRR 분포 카드 추가. p5/p25/p50/p75/p95 분위수 막대 + 히스토그램
  + 현재 진입의 백분위 라벨 (예: "상위 22% — 평균보다 좋은 진입")
- **로그-선형 회귀 채널 (장기 관점)** — 차트의 가시 구간에서 ln(가격) ~ a + b·t를 OLS로
  적합해 추세선과 ±1σ/±2σ 채널을 표시. 추정 CAGR · R² · 현재 z-score · 해석 라벨 카드.
  장기 관점에서만 켜지며, 차트 응답에 `regressionChannel` 필드로 동봉
- **스윙 시그널 마커 (스윙·데이 관점)** — MACD 크로스, RSI 50 크로스, 골든·데드 크로스
  (60/200), 20일 신고가 돌파, 20일 신저가 이탈 5종을 ▲(매수)/▼(매도) 도트로 차트에 오버레이.
  3봉 cooldown으로 노이즈 억제
- **티커 자동완성** — 입력칸에 첫 글자만 쳐도 야후 검색 API 결과(거래소·풀네임 포함)가 드롭다운
  으로 표시. ↑↓ 키보드 네비게이션 + Enter/`,` 즉시 선택. 백테스터(쉼표 구분 다중 토큰)와
  스윙·데이(단일 티커) 모드 모두 지원. 5분 메모리 LRU 캐시
- **상단 마켓 마퀴 컴팩트화** — 11개 지표를 데스크톱 한 줄에 펼쳐서 스크롤 없이 한눈에. 30초
  자동 갱신(백그라운드 탭 5분), 탭 복귀·온라인 복구 시 즉시 새로고침, "방금 / Ns 전" 라이브
  타임스탬프 표시
- 기간 모드: 최근 10년 / 최근 N년(1~40) / **상장일부터** / 커스텀 구간
- 매수 주기: 매일 / 매주 / 2주 / 매월 / 매년 — 휴장일이면 그 주기의 첫 거래일에 자동 매수
- 분수 매수 토글 — 끄면 정수 주식만 매수, 잔액은 다음 매수로 이월
- 지표: 총 투자금, 최종 평가액, 총 수익률, **연환산 IRR(Money-weighted, XIRR)**,
  **최대 낙폭(MDD)**, 평균 매수가, 보유 주식 수, 일시 매수 비교(총 수익률·CAGR)
- **VOO 벤치마크** 자동 비교 — 같은 기간·같은 주기로 VOO에 동일 DCA를 돌린 결과를 옆에 띄움
- 다중 티커 비교: 쉼표로 입력 → 비교 표 + `평가액/누적투자금` 비율 차트
- **상단 마켓 마퀴**: USD/KRW · DXY · 나스닥 · NQ선물 · S&P 500 · 다우 · SOX · VIX · 코스피 · 코스닥 · WTI 원유 (60초 폴링, 야후 무료 데이터 약 15분 지연)
- **국내장 지원** — 야후 심볼로 직접 입력. 코스피 `xxxxxx.KS`, 코스닥 `xxxxxx.KQ` (예: `005930.KS` 삼성전자, `069500.KS` KODEX 200, `133690.KS` TIGER 미국나스닥100)
- **상세 차트 페이지** (`/chart/[ticker]`) 및 스윙·데이 모드:
  - 인터벌 13종: 1m/3m/5m/10m/15m/30m/60m/120m/240m/일/주/월/년 (3m·10m·120m·240m·년봉은 클라이언트 리샘플링)
  - 토글 가능한 오버레이: 이평선 5/20/60/120/200, 볼린저 밴드(20, 2σ), RSI(14), Stochastic(14,3,3)
  - 관점 모드: **장기 투자 / 스윙 / 데이** — 인터벌·오버레이·손절익절 룰이 자동 변경
  - **스윙·데이 손절/익절선** (DCA 결과엔 노출 X): ATR(14) ×1.5(데이) / ×2(스윙) 트레일링 + 최근 10/20봉 고저점 지지·저항
  - **자동 갱신** — 스윙 60초 / 데이 15초 폴링, 탭 복귀 시 즉시 새로고침. 우상단 "방금 / Ns 전" 배지로 신선도 확인
- **커버드콜 ETF 자동 감지 + 배당 재투자 시뮬**:
  - 화이트리스트(JEPI/JEPQ/QYLD/SPYI/YMAX/YMAG/ULTY/TIGER 미국S&P500커버드콜 등) + 펀드명/설명
    키워드("covered call", "yieldmax", "커버드콜", "타겟커버드콜") + 분배 빈도/수익률 휴리스틱으로
    자동 판별
  - 감지되면 결과 패널 상단에 초록 배지 + 사유 표시. 잘못 감지된 경우 **X 버튼**으로 즉시 끔
  - 감지되지 않은 종목도 토글로 수동 적용 가능
  - 분배금 카드: 누적 수령액, trailing 12m 분배수익률, 투자금 대비 cash-on-cash
  - **재투자 vs 비재투자 비교** — 분배금을 다음 거래일 종가로 즉시 재매수했을 때의 평가액 차이
  - **주배당(YMAX/YMAG/ULTY 등) 자동 처리** — 분배 빈도를 가격 이벤트 간격에서 직접 추정
- 매수 내역 테이블 + CSV 다운로드

## 로컬 개발

```bash
npm install
npm run dev
# http://localhost:3000
```

빌드 확인:

```bash
npm run build
npm start
```

## Vercel 배포 — 가장 간단한 길

1. 이 폴더를 GitHub repo로 푸시 (예: `dca-backtester`).
2. [vercel.com](https://vercel.com) → **Add New Project** → 해당 repo 선택.
3. 프레임워크 자동 감지(**Next.js**) — 별도 설정 불필요. **Deploy** 클릭.
4. 1~2분 후 `https://<프로젝트>.vercel.app` 으로 접속.

> 환경변수 없이 동작합니다. Yahoo Finance 데이터는 인증이 필요 없는 공개 엔드포인트를
> 서버리스 함수에서 호출합니다.

### CLI로 배포하고 싶다면

```bash
npm i -g vercel
vercel              # 첫 배포(프리뷰)
vercel --prod       # 프로덕션 배포
```

### 함수 타임아웃

`app/api/backtest/route.ts` 상단의 `export const maxDuration = 60` 으로 60초까지
허용하도록 설정해 두었습니다(Hobby 플랜 기준 최대치). 보통 한 번에 1~3초이면 끝납니다.

### (선택) Vercel KV / Upstash Redis 가격 캐시

가격 시계열을 영구 캐시해서 Yahoo 호출을 90% 이상 줄일 수 있습니다. **환경 변수만
설정하면 자동 활성화**되며, 없으면 그냥 매번 직접 Yahoo를 호출합니다(코드 변경 불필요).

1. **Vercel Marketplace** → Storage → "Upstash for Redis" 추가 (무료 티어 충분).
2. 프로젝트의 환경 변수에 다음 값이 자동 주입됩니다:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
3. 재배포하면 끝. 헬스체크용 헤더는 별도로 노출하지 않습니다 (필요 시 `lib/cache.ts` 참조).

또는 직접 Upstash 콘솔에서 DB를 만든 뒤 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
을 넣어도 동작합니다.

캐시되는 항목 (모두 `lib/priceCache.ts`, `lib/cache.ts` 가 처리):

| 키 | TTL | 내용 |
| --- | --- | --- |
| `prices:v1:<TICKER>` | ∞ (증분 갱신) | 인셉션부터 현재까지의 일별 종가 + 배당 + 분할. 재요청 시 마지막 캐시 일자 다음 ±7일만 Yahoo에서 받아 머지 |
| `chart:v1:<ticker>:<interval>:<rangeDays>:<reg>` | 60s ~ 1h | 상세 차트 응답 (interval에 따라 TTL 다름) |
| `market:quotes:v1` | 30s | 상단 마켓 마퀴 |
| `sentiment:v1` | 5m | Fear & Greed |
| `quoteSummary:v1:<TICKER>` | 6h | 회사명·자산종류·배당률 등 메타 |
| `yahoo:news:v1` | 15m | Yahoo Finance RSS 헤드라인 (S2 시장 메모용) |
| `sentiment:commentary:v1` | 30m | Claude Haiku로 만든 한국어 시장 메모 (S2) |

콜드 스타트가 발생해도 KV가 살아있어 두 번째 요청부터는 거의 모두 캐시 히트입니다.

### (선택) Claude API · 자연어 시장 메모

상단 Fear & Greed 위젯에 *오늘의 시장 메모*(한국어 1~2문장) 카드를 추가합니다. F&G
점수·구성요소·Yahoo Finance 헤드라인을 묶어 30분마다 Claude Haiku에 전달하고, **입력
시그너처가 직전 라운드와 같으면 LLM 호출 자체를 건너뜁니다.** 시그너처가 다르더라도
의미상 변화가 없으면 모델이 `NO_CHANGE`만 반환하고 출력 토큰을 거의 쓰지 않도록
프롬프트되어 있습니다.

설정:

1. [Anthropic 콘솔](https://console.anthropic.com/)에서 API 키 발급.
2. Vercel 프로젝트 환경 변수에 추가:
   - `ANTHROPIC_API_KEY` — 필수
   - `ANTHROPIC_MODEL` — 선택 (기본 `claude-3-5-haiku-latest`)
3. 재배포. 키가 없으면 메모 카드는 자동으로 비표시됩니다.

비용 가이드 (KV·시그너처 캐시 적용):

- 30분 주기 × 24h = 48회/일 시그너처 체크 → 그중 LLM 실제 호출은 평균 ~20회/일
- 호출당 입력 ~700토큰 / 출력 평균 ~30토큰 (`NO_CHANGE` 비중이 큼)
- Haiku 가격 기준 일 약 $0.005, **월 $0.15 수준**

### (선택) AI 분석용 프롬프트 복사

각 결과 패널 우상단의 **"AI 프롬프트 복사"** 버튼은 백테스트 결과 전체를 한국어
Markdown + 수치표로 정합해 클립보드에 복사합니다. 우리 서버에서는 어떤 LLM도
호출하지 않으며, 사용자가 ChatGPT / Claude / Gemini 등 자기가 선호하는 모델에 직접
붙여넣어 자연어 해석을 받을 수 있습니다 (비용 0). 텍스트는 모달에서 미리보기 + 직접
편집 가능.

## 폴더 구조

```
app/
  layout.tsx                   # MarketMarquee 부착
  page.tsx
  chart/[ticker]/page.tsx      # 상세 차트 페이지
  globals.css
  api/
    backtest/route.ts          # POST /api/backtest (VOO 벤치마크 동시 계산)
    market/route.ts            # GET  /api/market   (마켓 마퀴 11종, 30초 캐시)
    chart/route.ts             # GET  /api/chart    (인터벌 13종 OHLCV)
components/
  Workspace.tsx                # 모드 탭 (DCA 백테스터 / 스윙·데이) + 라우팅
  BacktestForm.tsx             # DCA 폼 + 결과 라우팅 (client component)
  SwingDayWorkspace.tsx        # 스윙·데이 모드: 티커 검색 + AdvancedChart 임베드
  ResultPanel.tsx              # 단일 티커 KPI/차트/테이블 (배당 카드 포함)
  CompareChart.tsx             # 다중 티커 비율 차트
  CompareTable.tsx
  EquityChart.tsx              # 평가액 vs 투자금 (+ VOO 라인)
  PriceChart.tsx               # 주가 + 매수 마커 + 평균 매수가 라인
  PurchasesTable.tsx           # 매수 내역 + CSV 다운로드
  MarketMarquee.tsx            # 상단 실시간 시세 바 (한 줄 컴팩트, 자동 갱신)
  AdvancedChart.tsx            # 상세 차트 (인터벌/MA/BB/RSI/Stoch + 스윙·데이 손절익절 + 자동 갱신)
  Card.tsx, Kpi.tsx
lib/
  backtest.ts                  # DCA 엔진 (순수 TS)
  backtestApi.ts               # /api/backtest 응답 타입 (route 파일 외부에서 공유)
  yahoo.ts                     # 가격/Quote/QuoteSummary/Dividends fetch 래퍼
  marketTickers.ts             # 마켓 마퀴 심볼 목록
  indicators.ts                # MA/BB/RSI/Stoch/ATR/MACD 계산
  resample.ts                  # OHLC 리샘플링 (3m/10m/120m/240m/년봉)
  coveredCall.ts               # 커버드콜 ETF 자동 감지 (whitelist + 키워드 + cadence)
  dividends.ts                 # 분배금 분석 + 재투자/비재투자 비교 시뮬
  format.ts
streamlit-app/                 # (옵션) 기존 Python/Streamlit 버전
  app.py, backtest.py, requirements.txt
```

## 알아두면 좋은 것

- 가격은 **adjusted close**(배당·분할 반영) 기준입니다. 세금·수수료·환율은 미반영.
- 같은 종목에 동일 금액을 첫날 한 번에 투자한 결과(Lump-sum)도 항상 함께 계산하여
  "DCA가 더 나았는지"를 직접 비교할 수 있게 했습니다.
- IRR이 부호 변화 없이 단조 증가/감소하는 극단적 케이스에서는 “—”로 표시됩니다.
- 한 요청당 최대 10개 티커, 각 티커 실패 시 다른 티커는 계속 처리합니다.

## 라이선스

학습/개인 사용 목적의 샘플입니다. 자유롭게 수정해 사용하세요.
