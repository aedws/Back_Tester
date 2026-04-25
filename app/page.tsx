import { BacktestForm } from "@/components/BacktestForm";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-ink-muted">
            US Equities · DCA Backtester
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            미장 티커 적립식 매수 백테스터
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            상장일부터 또는 N년 단위로, 매일·매주·2주·매월·매년 주기의 DCA 시뮬레이션을 실행해
            총 수익률, 연환산 IRR, 최대 낙폭, 일시매수 비교까지 한눈에 확인하세요.
          </p>
        </div>
        <a
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-ink-muted hover:text-ink sm:inline"
        >
          데이터: Yahoo Finance · 배당/분할 조정
        </a>
      </header>

      <BacktestForm />

      <footer className="mt-12 border-t border-border pt-6 text-[11px] text-ink-dim">
        본 도구는 교육·참고용이며 투자 권유가 아닙니다. 가격·환율·세금·수수료 등 실거래 비용은
        반영되지 않습니다.
      </footer>
    </main>
  );
}
