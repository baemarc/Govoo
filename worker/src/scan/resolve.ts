import { MIN_TRADE_USD, USDC, USDC_DECIMALS, USDC_MIRROR } from '../chain.js';

export interface Leg {
  token: string;
  from: string;
  to: string;
  amount: bigint;
}

export interface TradeRow {
  wallet: string;
  token: string;
  side: 'buy' | 'sell';
  tokenAmount: bigint;
  usdcAmount: bigint | null;
  usd: number | null;
  counter: string;
  belowFloor: boolean;
}

export interface TransferRow {
  wallet: string;
  token: string;
  direction: 'in' | 'out';
  amount: bigint;
  counterparty: string | null;
}

const abs = (x: bigint) => (x < 0n ? -x : x);
export const usdcToUsd = (raw: bigint) => Number(raw) / 10 ** USDC_DECIMALS;

export function netDeltas(legs: Leg[], watched: (addr: string) => boolean): Map<string, Map<string, bigint>> {
  const out = new Map<string, Map<string, bigint>>();
  const bump = (w: string, token: string, d: bigint) => {
    let m = out.get(w);
    if (!m) out.set(w, (m = new Map()));
    m.set(token, (m.get(token) ?? 0n) + d);
  };
  for (const l of legs) {
    if (l.token === USDC_MIRROR || l.from === l.to) continue;
    if (watched(l.from)) bump(l.from, l.token, -l.amount);
    if (watched(l.to)) bump(l.to, l.token, l.amount);
  }
  for (const [w, m] of out) {
    for (const [t, d] of m) if (d === 0n) m.delete(t);
    if (m.size === 0) out.delete(w);
  }
  return out;
}

function soleCounterparty(legs: Leg[], wallet: string, token: string): string | null {
  const others = new Set<string>();
  for (const l of legs) {
    if (l.token !== token) continue;
    if (l.from === wallet) others.add(l.to);
    else if (l.to === wallet) others.add(l.from);
  }
  return others.size === 1 ? [...others][0]! : null;
}

export function resolveTx(legs: Leg[], watched: (addr: string) => boolean): { trades: TradeRow[]; transfers: TransferRow[] } {
  const trades: TradeRow[] = [];
  const transfers: TransferRow[] = [];

  for (const [wallet, deltas] of netDeltas(legs, watched)) {
    const usdc = deltas.get(USDC) ?? 0n;
    const tokens = [...deltas].filter(([t]) => t !== USDC);
    const plus = tokens.filter(([, d]) => d > 0n);
    const minus = tokens.filter(([, d]) => d < 0n);

    const transfer = (token: string, d: bigint) =>
      transfers.push({ wallet, token, direction: d > 0n ? 'in' : 'out', amount: abs(d),
        counterparty: soleCounterparty(legs, wallet, token) });

    const buysWithUsdc = usdc < 0n && plus.length > 0;
    const sellsForUsdc = usdc > 0n && minus.length > 0;

    if (buysWithUsdc && plus.length === 1 && minus.length === 0) {
      const [token, d] = plus[0]!;
      trades.push(usdcTrade(wallet, token, 'buy', d, abs(usdc)));
    } else if (sellsForUsdc && minus.length === 1 && plus.length === 0) {
      const [token, d] = minus[0]!;
      trades.push(usdcTrade(wallet, token, 'sell', abs(d), usdc));
    } else if (plus.length > 0 && minus.length > 0) {
      if (usdc !== 0n) transfer(USDC, usdc);
      const pair = plus.length === 1 && minus.length === 1;
      for (const [token, d] of plus) {
        trades.push({ wallet, token, side: 'buy', tokenAmount: d, usdcAmount: null, usd: null,
          counter: pair ? minus[0]![0] : 'multi', belowFloor: false });
      }
      for (const [token, d] of minus) {
        trades.push({ wallet, token, side: 'sell', tokenAmount: abs(d), usdcAmount: null, usd: null,
          counter: pair ? plus[0]![0] : 'multi', belowFloor: false });
      }
    } else if (buysWithUsdc || sellsForUsdc) {
      for (const [token, d] of buysWithUsdc ? plus : minus) {
        trades.push({ wallet, token, side: buysWithUsdc ? 'buy' : 'sell', tokenAmount: abs(d),
          usdcAmount: null, usd: null, counter: 'multi', belowFloor: false });
      }
    } else {
      for (const [token, d] of deltas) transfer(token, d);
    }
  }
  return { trades, transfers };
}

export function relayCounterparty(
  legs: Leg[], wallet: string, delta: bigint, exclude: Set<string>,
): { party: string; usdc: bigint } | null {
  let best: { party: string; usdc: bigint } | null = null;
  for (const [addr, m] of netDeltas(legs, () => true)) {
    if (addr === wallet || exclude.has(addr) || m.size !== 1) continue;
    const u = m.get(USDC);
    if (u === undefined || (delta > 0n ? u >= 0n : u <= 0n)) continue;
    if (!best || abs(u) > best.usdc) best = { party: addr, usdc: abs(u) };
  }
  return best;
}

export function usdcTrade(wallet: string, token: string, side: 'buy' | 'sell', tokenAmount: bigint, usdcAmount: bigint): TradeRow {
  const usd = usdcToUsd(usdcAmount);
  return { wallet, token, side, tokenAmount, usdcAmount, usd, counter: 'usdc', belowFloor: usd < MIN_TRADE_USD };
}
