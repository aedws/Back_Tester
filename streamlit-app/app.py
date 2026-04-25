"""Streamlit UI for the DCA backtester.

Run with:
    streamlit run app.py
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from backtest import (
    DcaResult,
    fetch_prices,
    fmt_money,
    fmt_pct,
    run_dca,
)


st.set_page_config(
    page_title="US Ticker DCA Backtester",
    page_icon="📈",
    layout="wide",
)


# ---------------------------------------------------------------------------
# Cached data loaders
# ---------------------------------------------------------------------------
@st.cache_data(show_spinner=False, ttl=60 * 30)
def _cached_prices(ticker: str, mode: str, years: int, start, end) -> pd.Series:
    return fetch_prices(ticker, mode=mode, years=years, start=start, end=end)


# ---------------------------------------------------------------------------
# Sidebar inputs
# ---------------------------------------------------------------------------
st.sidebar.header("Backtest Settings")

tickers_raw = st.sidebar.text_input(
    "Tickers (comma-separated)",
    value="AAPL",
    help="예: AAPL, MSFT, SPY, QQQ — 여러 개를 비교하려면 쉼표로 구분.",
)

mode_label = st.sidebar.radio(
    "Period",
    options=["Last 10 years", "Last N years", "Since inception", "Custom range"],
    index=0,
)

years_input = 10
custom_start: date | None = None
custom_end: date | None = None

if mode_label == "Last N years":
    years_input = st.sidebar.slider("Years", min_value=1, max_value=40, value=10)
    mode_key = "years"
elif mode_label == "Last 10 years":
    years_input = 10
    mode_key = "years"
elif mode_label == "Since inception":
    mode_key = "inception"
else:
    today = date.today()
    default_start = today - timedelta(days=365 * 10)
    custom_start = st.sidebar.date_input("Start", value=default_start)
    custom_end = st.sidebar.date_input("End", value=today)
    mode_key = "custom"

frequency = st.sidebar.selectbox(
    "Buy frequency",
    options=["daily", "weekly", "biweekly", "monthly", "yearly"],
    index=3,
    format_func=lambda f: {
        "daily": "매일",
        "weekly": "매주",
        "biweekly": "2주마다",
        "monthly": "매월",
        "yearly": "매년",
    }[f],
)

amount = st.sidebar.number_input(
    "Amount per purchase (USD)",
    min_value=1.0,
    value=500.0,
    step=50.0,
)

fractional = st.sidebar.checkbox(
    "Fractional shares",
    value=True,
    help="해제하면 정수 주식만 매수하고 남은 현금은 다음 매수 시점으로 이월됩니다.",
)

run = st.sidebar.button("Run backtest", type="primary", use_container_width=True)


# ---------------------------------------------------------------------------
# Main view
# ---------------------------------------------------------------------------
st.title("📈 미장 티커 DCA 백테스터")
st.caption(
    "yfinance의 무상 데이터(배당·분할 자동 조정)를 사용합니다. "
    "상장일부터 또는 N년 단위로 적립식 매수를 시뮬레이션해 수익률·IRR·MDD를 계산합니다."
)


def _run_one(ticker: str) -> DcaResult | None:
    try:
        prices = _cached_prices(
            ticker, mode_key, years_input, custom_start, custom_end
        )
    except Exception as e:
        st.error(f"[{ticker}] 가격 데이터를 불러오지 못했습니다: {e}")
        return None
    try:
        return run_dca(
            prices,
            amount=float(amount),
            frequency=frequency,
            fractional=bool(fractional),
        )
    except Exception as e:
        st.error(f"[{ticker}] 백테스트 실행 중 오류: {e}")
        return None


def _kpi_row(res: DcaResult) -> None:
    s = res.summary
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("총 투자금", fmt_money(s["total_invested"]))
    c2.metric("최종 평가액", fmt_money(s["final_value"]))
    c3.metric(
        "총 수익률",
        fmt_pct(s["total_return"]),
        delta=fmt_money(s["profit"]),
    )
    c4.metric("연환산 IRR", fmt_pct(s["irr_annualized"]))
    c5.metric("최대 낙폭(MDD)", fmt_pct(s["max_drawdown"]))

    c6, c7, c8, c9, c10 = st.columns(5)
    c6.metric("기간", f"{s['years']:.2f} 년")
    c7.metric("매수 횟수", f"{s['n_purchases']:,}")
    c8.metric("평균 매수가", fmt_money(s["avg_cost"]))
    c9.metric("현재 주가", fmt_money(s["last_price"]))
    c10.metric("총 보유 주수", f"{s['total_shares']:,.4f}")


def _equity_chart(res: DcaResult) -> go.Figure:
    eq = res.equity_curve
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=eq.index, y=eq["value"],
            name="Portfolio value",
            line=dict(width=2),
            fill="tozeroy",
            fillcolor="rgba(46, 134, 222, 0.12)",
        )
    )
    fig.add_trace(
        go.Scatter(
            x=eq.index, y=eq["invested"],
            name="Cumulative invested",
            line=dict(width=2, dash="dash", color="#888"),
        )
    )
    buy_idx = res.purchases.index.intersection(eq.index)
    fig.add_trace(
        go.Scatter(
            x=buy_idx,
            y=eq.loc[buy_idx, "value"],
            mode="markers",
            name="Buy",
            marker=dict(size=6, color="#2ca02c", symbol="triangle-up"),
            hovertemplate=(
                "%{x|%Y-%m-%d}"
                "<br>Price $%{customdata[0]:.2f}"
                "<br>Shares %{customdata[1]:.4f}"
                "<extra></extra>"
            ),
            customdata=res.purchases.loc[buy_idx, ["price", "shares"]].values,
        )
    )
    fig.update_layout(
        title=f"{res.ticker} — Portfolio value vs invested",
        xaxis_title=None,
        yaxis_title="USD",
        height=480,
        legend=dict(orientation="h", y=1.05, x=0),
        margin=dict(l=10, r=10, t=60, b=10),
    )
    return fig


def _price_chart(res: DcaResult) -> go.Figure:
    eq = res.equity_curve
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(x=eq.index, y=eq["price"], name="Adj. close", line=dict(width=1.5))
    )
    fig.add_trace(
        go.Scatter(
            x=res.purchases.index,
            y=res.purchases["price"],
            mode="markers",
            name="Buy",
            marker=dict(size=7, color="#2ca02c", symbol="triangle-up"),
        )
    )
    avg = res.summary["avg_cost"]
    fig.add_hline(
        y=avg,
        line_dash="dot",
        line_color="orange",
        annotation_text=f"Avg cost {fmt_money(avg)}",
        annotation_position="top left",
    )
    fig.update_layout(
        title=f"{res.ticker} — Price & buy points",
        height=380,
        yaxis_title="USD",
        margin=dict(l=10, r=10, t=60, b=10),
    )
    return fig


def _render_single(res: DcaResult) -> None:
    s = res.summary
    st.subheader(f"{s['ticker']}  ·  {s['start_date']} → {s['end_date']}")
    _kpi_row(res)

    st.plotly_chart(_equity_chart(res), use_container_width=True)
    st.plotly_chart(_price_chart(res), use_container_width=True)

    with st.expander("Lump-sum (일시 매수) 비교"):
        c1, c2, c3 = st.columns(3)
        c1.metric("일시 매수 최종 평가액", fmt_money(s["buy_hold_final_value"]))
        c2.metric("일시 매수 총 수익률", fmt_pct(s["buy_hold_return"]))
        c3.metric("일시 매수 CAGR", fmt_pct(s["buy_hold_cagr"]))
        st.caption(
            "동일한 총 투자금을 백테스트 첫 거래일에 한 번에 투자했을 때의 결과 (참고용)."
        )

    with st.expander("매수 내역"):
        purchases = res.purchases.copy()
        purchases.index = purchases.index.date
        purchases["cum_shares"] = purchases["shares"].cumsum()
        purchases["cum_invested"] = purchases["invested"].cumsum()
        st.dataframe(
            purchases.style.format(
                {
                    "price": "${:,.2f}",
                    "shares": "{:,.6f}",
                    "invested": "${:,.2f}",
                    "cum_shares": "{:,.6f}",
                    "cum_invested": "${:,.2f}",
                }
            ),
            use_container_width=True,
        )
        st.download_button(
            "Download purchases (CSV)",
            data=purchases.to_csv().encode("utf-8"),
            file_name=f"{s['ticker']}_dca_purchases.csv",
            mime="text/csv",
        )


def _render_compare(results: list[DcaResult]) -> None:
    st.subheader("티커 비교")

    rows = []
    for r in results:
        s = r.summary
        rows.append(
            {
                "Ticker": s["ticker"],
                "Start": s["start_date"],
                "End": s["end_date"],
                "Years": round(s["years"], 2),
                "Buys": s["n_purchases"],
                "Invested": s["total_invested"],
                "Final value": s["final_value"],
                "Profit": s["profit"],
                "Total return": s["total_return"],
                "IRR": s["irr_annualized"],
                "MDD": s["max_drawdown"],
                "Avg cost": s["avg_cost"],
            }
        )
    df = pd.DataFrame(rows).set_index("Ticker")
    st.dataframe(
        df.style.format(
            {
                "Invested": "${:,.0f}",
                "Final value": "${:,.0f}",
                "Profit": "${:,.0f}",
                "Total return": "{:.2%}",
                "IRR": "{:.2%}",
                "MDD": "{:.2%}",
                "Avg cost": "${:,.2f}",
            }
        ),
        use_container_width=True,
    )

    fig = go.Figure()
    for r in results:
        eq = r.equity_curve
        fig.add_trace(
            go.Scatter(
                x=eq.index,
                y=eq["value"] / eq["invested"].replace(0, pd.NA),
                name=r.ticker,
                mode="lines",
            )
        )
    fig.update_layout(
        title="포트폴리오 가치 / 누적 투자금 (1.0 = 본전)",
        yaxis_title="ratio",
        height=420,
        margin=dict(l=10, r=10, t=60, b=10),
        legend=dict(orientation="h", y=1.05, x=0),
    )
    st.plotly_chart(fig, use_container_width=True)


tickers = [t.strip().upper() for t in tickers_raw.split(",") if t.strip()]

if not run:
    st.info("좌측에서 티커·기간·금액·주기를 설정하고 **Run backtest**를 누르세요.")
    st.stop()

if not tickers:
    st.warning("티커를 한 개 이상 입력해주세요.")
    st.stop()

with st.spinner(f"Running backtest for {', '.join(tickers)}..."):
    results: list[DcaResult] = []
    for tk in tickers:
        res = _run_one(tk)
        if res is not None:
            results.append(res)

if not results:
    st.stop()

if len(results) > 1:
    _render_compare(results)
    st.divider()

for res in results:
    _render_single(res)
    st.divider()
