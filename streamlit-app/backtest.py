"""DCA backtest engine for US-listed tickers.

Public API:
    fetch_prices(ticker, mode, years, start, end)  -> pd.Series of adjusted closes
    run_dca(prices, amount, frequency, day_rule)   -> DcaResult
    DcaResult.summary, DcaResult.equity_curve, DcaResult.purchases
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd
import yfinance as yf


Frequency = Literal["daily", "weekly", "biweekly", "monthly", "yearly"]
PeriodMode = Literal["years", "inception", "custom"]


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def fetch_prices(
    ticker: str,
    mode: PeriodMode = "years",
    years: int = 10,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> pd.Series:
    """Return a daily adjusted-close price series for `ticker`.

    Modes:
        "years"     : last `years` years up to today.
        "inception" : full available history (period="max").
        "custom"    : explicit start/end dates.
    """
    ticker = ticker.strip().upper()
    if not ticker:
        raise ValueError("Ticker is empty.")

    tk = yf.Ticker(ticker)

    if mode == "inception":
        df = tk.history(period="max", auto_adjust=True)
    elif mode == "years":
        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=int(round(years * 365.25)) + 5)
        df = tk.history(start=start_dt, end=end_dt + timedelta(days=1), auto_adjust=True)
    elif mode == "custom":
        if start is None or end is None:
            raise ValueError("start and end are required for custom mode.")
        df = tk.history(
            start=pd.Timestamp(start),
            end=pd.Timestamp(end) + pd.Timedelta(days=1),
            auto_adjust=True,
        )
    else:
        raise ValueError(f"Unknown mode: {mode}")

    if df is None or df.empty:
        raise ValueError(f"No price data returned for '{ticker}'.")

    closes = df["Close"].dropna()
    closes.index = pd.DatetimeIndex(closes.index).tz_localize(None).normalize()
    closes.name = ticker
    return closes


# ---------------------------------------------------------------------------
# DCA simulation
# ---------------------------------------------------------------------------
@dataclass
class DcaResult:
    ticker: str
    purchases: pd.DataFrame      # columns: date, price, shares, invested
    equity_curve: pd.DataFrame   # columns: invested, shares, value
    summary: dict


def _build_buy_dates(
    index: pd.DatetimeIndex,
    frequency: Frequency,
) -> pd.DatetimeIndex:
    """Pick the first available trading day in each cadence bucket."""
    if len(index) == 0:
        return pd.DatetimeIndex([])

    if frequency == "daily":
        return index

    bucket_map = {
        "weekly": index.to_period("W-MON"),
        "biweekly": None,  # handled below
        "monthly": index.to_period("M"),
        "yearly": index.to_period("Y"),
    }

    if frequency == "biweekly":
        weeks = index.to_period("W-MON")
        unique_weeks = pd.PeriodIndex(sorted(set(weeks)))
        biweek_id = {w: i // 2 for i, w in enumerate(unique_weeks)}
        bucket = pd.Index([biweek_id[w] for w in weeks])
    else:
        bucket = bucket_map[frequency]
        if bucket is None:
            raise ValueError(f"Unsupported frequency: {frequency}")

    s = pd.Series(index, index=bucket)
    first_day_per_bucket = s.groupby(level=0, sort=False).min()
    return pd.DatetimeIndex(sorted(first_day_per_bucket.values))


def _max_drawdown(values: pd.Series) -> float:
    if values.empty:
        return 0.0
    running_max = values.cummax()
    drawdown = (values - running_max) / running_max
    return float(drawdown.min())


def _xirr(cashflows: list[tuple[pd.Timestamp, float]]) -> Optional[float]:
    """Annualized internal rate of return for irregular cashflows.

    cashflows: list of (date, amount). Outflows negative, inflows positive.
    Falls back to None if it cannot converge.
    """
    if not cashflows or len(cashflows) < 2:
        return None
    dates = np.array([pd.Timestamp(d) for d, _ in cashflows])
    amounts = np.array([a for _, a in cashflows], dtype=float)
    if not (np.any(amounts > 0) and np.any(amounts < 0)):
        return None
    t0 = dates[0]
    years = np.array([(d - t0).days / 365.25 for d in dates])

    def npv(rate: float) -> float:
        return float(np.sum(amounts / (1.0 + rate) ** years))

    low, high = -0.9999, 10.0
    f_low, f_high = npv(low), npv(high)
    if np.isnan(f_low) or np.isnan(f_high) or f_low * f_high > 0:
        return None
    for _ in range(200):
        mid = 0.5 * (low + high)
        f_mid = npv(mid)
        if abs(f_mid) < 1e-7:
            return float(mid)
        if f_low * f_mid < 0:
            high, f_high = mid, f_mid
        else:
            low, f_low = mid, f_mid
    return float(0.5 * (low + high))


def run_dca(
    prices: pd.Series,
    amount: float,
    frequency: Frequency = "monthly",
    fractional: bool = True,
) -> DcaResult:
    """Simulate a DCA strategy over `prices`.

    Parameters
    ----------
    prices : pd.Series
        Adjusted close prices indexed by trading day.
    amount : float
        Cash invested at every cadence step.
    frequency : Frequency
        How often to buy. The first available trading day inside each bucket
        is used so weekends/holidays are handled automatically.
    fractional : bool
        If False, only whole shares are purchased and any unspent cash is
        carried forward to the next purchase date.
    """
    if amount <= 0:
        raise ValueError("amount must be positive.")
    if prices.empty:
        raise ValueError("prices is empty.")

    prices = prices.sort_index()
    buy_dates = _build_buy_dates(prices.index, frequency)
    if len(buy_dates) == 0:
        raise ValueError("No buy dates were generated.")

    rows = []
    cash_carry = 0.0
    for d in buy_dates:
        price = float(prices.loc[d])
        budget = amount + cash_carry
        if fractional:
            shares = budget / price
            spent = budget
            cash_carry = 0.0
        else:
            shares = float(int(budget // price))
            spent = shares * price
            cash_carry = budget - spent
        rows.append((d, price, shares, spent))

    purchases = pd.DataFrame(rows, columns=["date", "price", "shares", "invested"])
    purchases.set_index("date", inplace=True)

    cum_shares_on_buy = purchases["shares"].cumsum()
    cum_invested_on_buy = purchases["invested"].cumsum()

    daily = pd.DataFrame(index=prices.index)
    daily["price"] = prices
    daily["shares"] = cum_shares_on_buy.reindex(daily.index).ffill().fillna(0.0)
    daily["invested"] = cum_invested_on_buy.reindex(daily.index).ffill().fillna(0.0)
    daily["value"] = daily["shares"] * daily["price"]

    total_invested = float(daily["invested"].iloc[-1])
    final_value = float(daily["value"].iloc[-1])
    total_shares = float(daily["shares"].iloc[-1])
    avg_cost = total_invested / total_shares if total_shares > 0 else float("nan")
    last_price = float(daily["price"].iloc[-1])
    profit = final_value - total_invested
    total_return = profit / total_invested if total_invested > 0 else float("nan")

    days = (daily.index[-1] - daily.index[0]).days
    years = days / 365.25 if days > 0 else float("nan")

    # Money-weighted return (XIRR)
    cashflows = [(d, -float(v)) for d, v in purchases["invested"].items()]
    cashflows.append((daily.index[-1], final_value))
    irr = _xirr(cashflows)

    # Buy-and-hold lump-sum benchmark (invest all on day 1)
    first_price = float(prices.iloc[0])
    bh_shares = total_invested / first_price
    bh_final = bh_shares * last_price
    bh_return = (bh_final / total_invested) - 1 if total_invested > 0 else float("nan")
    bh_cagr = (
        (bh_final / total_invested) ** (1 / years) - 1
        if total_invested > 0 and years and years > 0
        else float("nan")
    )

    summary = {
        "ticker": prices.name or "",
        "start_date": daily.index[0].date(),
        "end_date": daily.index[-1].date(),
        "years": years,
        "n_purchases": int(len(purchases)),
        "total_invested": total_invested,
        "final_value": final_value,
        "profit": profit,
        "total_return": total_return,
        "irr_annualized": irr,
        "total_shares": total_shares,
        "avg_cost": avg_cost,
        "last_price": last_price,
        "max_drawdown": _max_drawdown(daily["value"]),
        "buy_hold_final_value": bh_final,
        "buy_hold_return": bh_return,
        "buy_hold_cagr": bh_cagr,
    }

    return DcaResult(
        ticker=prices.name or "",
        purchases=purchases,
        equity_curve=daily,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Convenience formatting helpers (used by the Streamlit UI)
# ---------------------------------------------------------------------------
def fmt_money(x: float) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    return f"${x:,.2f}"


def fmt_pct(x: float) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "—"
    return f"{x * 100:.2f}%"
