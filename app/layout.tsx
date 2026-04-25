import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "US Ticker DCA Backtester",
  description:
    "미국 상장 티커별로 상장일부터 또는 N년 단위 DCA(적립식 매수) 백테스트를 실행하고 IRR·MDD·Lump-sum 비교까지 보여주는 무료 웹 도구.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-screen bg-bg text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
