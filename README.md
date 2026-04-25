# 미장 티커 DCA 백테스터 (Vercel 배포용)

미국 상장 티커를 대상으로 **상장일부터** 또는 **N년 단위**로 DCA(적립식 매수) 백테스트를
돌려주는 Next.js 14 앱입니다. Vercel에 그대로 올라가도록 구성돼 있습니다.

- **Frontend**: Next.js (App Router) · TypeScript · Tailwind CSS · Recharts
- **Data**: [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) (Yahoo Finance, 배당/분할 자동 조정)
- **API**: `app/api/backtest/route.ts` — Node 런타임 서버리스 함수
- **Backtest 엔진**: `lib/backtest.ts` (순수 TS, IRR(XIRR)·MDD·CAGR·Lump-sum 비교 포함)

## 주요 기능

- 기간 모드: 최근 10년 / 최근 N년(1~40) / **상장일부터** / 커스텀 구간
- 매수 주기: 매일 / 매주 / 2주 / 매월 / 매년 — 휴장일이면 그 주기의 첫 거래일에 자동 매수
- 분수 매수 토글 — 끄면 정수 주식만 매수, 잔액은 다음 매수로 이월
- 지표: 총 투자금, 최종 평가액, 총 수익률, **연환산 IRR(Money-weighted, XIRR)**,
  **최대 낙폭(MDD)**, 평균 매수가, 보유 주식 수, 일시 매수 비교(총 수익률·CAGR)
- 다중 티커 비교: 쉼표로 입력 → 비교 표 + `평가액/누적투자금` 비율 차트
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

## 폴더 구조

```
app/
  layout.tsx
  page.tsx
  globals.css
  api/
    backtest/route.ts          # POST /api/backtest
components/
  BacktestForm.tsx             # 폼 + 결과 라우팅 (client component)
  ResultPanel.tsx              # 단일 티커 KPI/차트/테이블
  CompareChart.tsx             # 다중 티커 비율 차트
  CompareTable.tsx
  EquityChart.tsx              # 평가액 vs 투자금
  PriceChart.tsx               # 주가 + 매수 마커 + 평균 매수가 라인
  PurchasesTable.tsx           # 매수 내역 + CSV 다운로드
  Card.tsx, Kpi.tsx
lib/
  backtest.ts                  # DCA 엔진 (순수 TS)
  yahoo.ts                     # 가격 fetch 래퍼
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
