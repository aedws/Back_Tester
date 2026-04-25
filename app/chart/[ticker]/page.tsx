import Link from "next/link";

import { AdvancedChart } from "@/components/AdvancedChart";

export const dynamic = "force-dynamic";

export default function ChartPage({
  params,
}: {
  params: { ticker: string };
}) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-xs text-ink-muted hover:text-accent"
          >
            ← 백테스터로 돌아가기
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {ticker} 상세 차트
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            관점(장기 투자 / 스윙 / 데이)에 맞춰 인터벌과 보조지표가 자동으로 조정됩니다.
            오버레이는 자유롭게 켜고 끌 수 있습니다.
          </p>
        </div>
      </header>

      <AdvancedChart ticker={ticker} />

      <footer className="mt-12 border-t border-border pt-6 text-[11px] text-ink-dim">
        데이터: Yahoo Finance · 분봉은 보존 한도(1m=7일, 5/15/30m=60일, 60m=730일)가 있습니다.
        손절/익절선은 시중 표준(ATR ×1.5~2, N봉 고저점) 기반의 가이드이며, 매매 권유가 아닙니다.
      </footer>
    </main>
  );
}
