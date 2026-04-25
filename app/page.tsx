import { Workspace } from "@/components/Workspace";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-ink-muted">
            US · KR Equities · Tools
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            DCA 백테스터 · 단기 트레이드 가이드
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            장기 적립식 시뮬레이션과 스윙·데이 단기 트레이드 가이드를 한 화면에서
            전환하며 사용하세요. 상단 탭으로 모드를 바꿀 수 있습니다.
          </p>
        </div>
        <a
          href="https://github.com/aedws/Back_Tester"
          target="_blank"
          rel="noreferrer"
          className="hidden text-xs text-ink-muted hover:text-ink sm:inline"
        >
          데이터: Yahoo Finance · 약 15분 지연
        </a>
      </header>

      <Workspace />

      <footer className="mt-12 border-t border-border pt-6 text-[11px] text-ink-dim">
        본 도구는 교육·참고용이며 투자 권유가 아닙니다. 가격·환율·세금·수수료 등 실거래 비용은
        반영되지 않습니다.
      </footer>
    </main>
  );
}
