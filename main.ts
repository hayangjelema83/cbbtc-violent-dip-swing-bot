// Violent-dip swing bot, long only.
//
// Idea: on a 1-minute cbBTC market the money is in snap-backs after
// violent dips, not in buying every dip. A slow grind down keeps falling
// (and a quiet drift never bounces far enough to pay the ~28 bps a round
// trip costs); a violent dip snaps back. So the bot only buys a dip that
// is violent by one of two signatures, and only while the market is
// actually moving:
//
//   - Indicators, over the symbol's own bars: ATR(14) of the true range
//     in bps of the close (Wilder's: the first value is the mean of the
//     first 14 true ranges, then 13/14 of the last plus 1/14 of the
//     newest), and the trailing 60-bar high with how many bars ago it
//     was set.
//   - Entry, on a bar's close (filled at the next open), full cash, when
//     flat, fewer than 3 round trips done, and at least 120 bars of the
//     window remain (a swing needs ~90 bars for its take-profit to
//     develop, so a trade opened in the last two hours cannot reach it
//     before the flatten and can only lose):
//       Tier A, a sharp rejection off a fresh high: the close is at
//         least 45 bps below the 60-bar high, ATR(14) is at least 8 bps,
//         and the high was set at most 25 bars ago.
//       Tier B, a capitulation plunge: the close is at least 130 bps
//         below the 60-bar high and ATR(14) is at least 5 bps.
//   - Exit, the whole position: 70 bps take-profit or 50 bps stop-loss
//     off the entry fill price, or 240 bars held (a dead trade). Each is
//     read again on every bar, so a sell the market refuses is sent again
//     on the next bar while its reason still holds.
//   - A round trip is counted when a sell fill lands, and the entry fill
//     price comes from the buy fill the harness reports, so the
//     take-profit and stop-loss are measured off the price actually paid,
//     not the close the order was decided on.
//   - The indicators run in float64 on + - * / alone, so the same bars
//     give the same orders, run after run.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Bars of history the high is taken over. */
const HIGH_BARS = 60;
/** ATR(14), in bps of the close. */
const ATR_BARS = 14;
/** Tier A: at least this far below the 60-bar high, in bps. */
const TIER_A_DIP_BPS = 45;
/** Tier A: ATR(14) at least this, in bps. */
const TIER_A_ATR_BPS = 8;
/** Tier A: the 60-bar high set at most this many bars ago. */
const TIER_A_HIGH_AGE_BARS = 25;
/** Tier B: at least this far below the 60-bar high, in bps. */
const TIER_B_DIP_BPS = 130;
/** Tier B: ATR(14) at least this, in bps. */
const TIER_B_ATR_BPS = 5;
/** Take-profit: 70 bps over the entry fill price. */
const TP_BPS = 70;
/** Stop-loss: 50 bps under the entry fill price. */
const SL_BPS = 50;
/** A position held this many bars is closed as a dead trade. */
const MAX_HOLD_BARS = 240;
/** At most this many round trips in the window. */
const MAX_ROUND_TRIPS = 3;
/** No new entry with fewer than this many bars of the window left. */
const ENTRY_CUTOFF_BARS = 120;
/** The window is 1,440 one-minute bars (dev and race alike). */
const TOTAL_BARS = 1440;
/** Each order caps its slippage at 100 bps past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;

interface Series {
  /** Closes so far, as USD (raw price / 10^5). */
  closes: number[];
  /** The first ATR_BARS true ranges, while the average is not set yet. */
  first: number[];
  /** ATR(14) in bps, once set. */
  atr: number | null;
  /** The previous bar's close, once seen. */
  prevClose: number | null;
}

const series = new Map<string, Series>();

function push(bar: { symbol: string; o: string; h: string; l: string; c: string }): Series {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { closes: [], first: [], atr: null, prevClose: null };
    series.set(bar.symbol, s);
  }
  const h = Number(bar.h) / 1e5;
  const l = Number(bar.l) / 1e5;
  const c = Number(bar.c) / 1e5;
  s.closes.push(c);
  if (s.prevClose !== null) {
    const tr = Math.max(h - l, Math.abs(h - s.prevClose), Math.abs(l - s.prevClose)) / c * 10000;
    if (s.atr === null) {
      s.first.push(tr);
      if (s.first.length === ATR_BARS) {
        s.atr = s.first.reduce((a, x) => a + x, 0) / ATR_BARS;
      }
    } else {
      s.atr = (s.atr * (ATR_BARS - 1) + tr) / ATR_BARS;
    }
  }
  s.prevClose = c;
  return s;
}

/** The entry state, kept from the fills the harness reports. */
const book = {
  /** Round trips closed so far (a sell fill landed). */
  roundTrips: 0,
  /** The entry fill price in USD, while a position is open. */
  entryPx: null as number | null,
  /** Bars held since the entry fill. */
  heldBars: 0,
};

await runBars({
  onBatch(state, batch) {
    // Fold in this batch's fills first: a buy fill opens the position at
    // the price actually paid, a sell fill (not the harness's own flatten)
    // closes one round trip.
    for (const fill of batch.fills) {
      if (fill.status !== 'filled' || fill.client_id.startsWith('_')) continue;
      if (fill.side === 'buy') {
        book.entryPx = Number(fill.price) / 1e5;
        book.heldBars = 0;
      } else {
        book.roundTrips++;
        book.entryPx = null;
        book.heldBars = 0;
      }
    }
    for (const bar of batch.bars) push(bar);
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined) continue;
      const held = state.positions.get(symbol);
      const close = state.close(symbol);
      const closeNum = close === null ? null : Number(close) / 1e5;
      if (held !== undefined) {
        book.heldBars++;
        if (book.entryPx !== null && closeNum !== null) {
          const tp = book.entryPx * (1 + TP_BPS / 10000);
          const sl = book.entryPx * (1 - SL_BPS / 10000);
          if (closeNum >= tp || closeNum <= sl || book.heldBars >= MAX_HOLD_BARS) {
            sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          }
        }
        continue;
      }
      // Flat: only a violent dip opens a position, and only while the
      // window has room left for the swing and the round-trip budget does.
      if (book.roundTrips >= MAX_ROUND_TRIPS) continue;
      if (state.seq >= TOTAL_BARS - ENTRY_CUTOFF_BARS) continue;
      if (s.closes.length < HIGH_BARS + 1 || s.atr === null || closeNum === null) continue;
      const window = s.closes.slice(-HIGH_BARS);
      let high = -Infinity;
      let highPos = -1;
      for (let k = 0; k < window.length; k++) {
        if (window[k] > high) {
          high = window[k];
          highPos = k;
        }
      }
      const barsSinceHigh = window.length - 1 - highPos;
      const dipBps = (high - closeNum) / high * 10000;
      const tierA = dipBps >= TIER_A_DIP_BPS && s.atr >= TIER_A_ATR_BPS && barsSinceHigh <= TIER_A_HIGH_AGE_BARS;
      const tierB = dipBps >= TIER_B_DIP_BPS && s.atr >= TIER_B_ATR_BPS;
      if (tierA || tierB) entries.push(symbol);
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
