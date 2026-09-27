export interface PosEvent {
  ts: number;
  kind: 'buy' | 'sell' | 'in' | 'out';
  qty: number;
  usd: number | null;
}

export interface Position {
  qty: number;
  costedQty: number;
  costUsd: number;
  costlessQty: number;
  realizedUsd: number;
  peakQty: number;
  held: [number, number | null][];
}

const DUST = 0.01;

export function replay(events: PosEvent[]): Position {
  const p: Position = { qty: 0, costedQty: 0, costUsd: 0, costlessQty: 0, realizedUsd: 0, peakQty: 0, held: [] };
  const holding = () => p.qty > 0 && p.qty > p.peakQty * DUST;

  const inFirst = (e: PosEvent) => (e.kind === 'buy' || e.kind === 'in' ? 0 : 1);
  for (const e of [...events].sort((a, b) => a.ts - b.ts || inFirst(a) - inFirst(b))) {
    const wasHolding = holding();
    if (e.kind === 'buy' && e.usd != null) { p.costedQty += e.qty; p.costUsd += e.usd; }
    else if (e.kind === 'buy' || e.kind === 'in') p.costlessQty += e.qty;
    else {
      const out = Math.min(e.qty, p.qty);
      if (out > 0) {
        const costedShare = p.costedQty / p.qty;
        const fromCosted = out * costedShare;
        const avg = p.costedQty > 0 ? p.costUsd / p.costedQty : 0;
        if (e.kind === 'sell' && e.usd != null && fromCosted > 0) {
          p.realizedUsd += e.usd * (out / e.qty) * costedShare - avg * fromCosted;
        }
        p.costUsd -= avg * fromCosted;
        p.costedQty -= fromCosted;
        p.costlessQty -= out - fromCosted;
      }
    }
    p.qty = p.costedQty + p.costlessQty;
    if (p.qty < 1e-12) { p.qty = p.costedQty = p.costlessQty = p.costUsd = 0; }
    p.peakQty = Math.max(p.peakQty, p.qty);

    const isHolding = holding();
    if (!wasHolding && isHolding) p.held.push([e.ts, null]);
    else if (wasHolding && !isHolding) p.held[p.held.length - 1]![1] = e.ts;
  }
  return p;
}

export const heldAt = (p: Position, ts: number) => p.held.some(([a, b]) => a <= ts && (b == null || ts < b));
