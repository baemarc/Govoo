import { num } from './config.js';
import { USDC } from './chain.js';
import { now, type DB } from './db.js';
import { loadBalances, reconcile, withOpening } from './calc/board.js';
import { replay, type PosEvent } from './calc/positions.js';

export const SMART_WINDOW_SEC = num('SMART_WINDOW_DAYS') * 86_400;
export const SMART_MIN_PNL_USD = num('SMART_MIN_PNL_USD');
export const SMART_MIN_LIQ_USD = num('SMART_MIN_LIQ_USD');
export const SMART_EVERY_SEC = 86_400;
export const SMART_PRICE_MAX_AGE_SEC = 6 * 3600;

export interface Pnl { realized: number; unrealized: number; total: number }

export function tokenPnl(ev: PosEvent[], balance: number | undefined, price: number | null, liq: number | null, at: number,
  asOf = at): Pnl {
  const cut = at - SMART_WINDOW_SEC;
  const all = reconcile(ev, balance, at, asOf);
  const before = replay(withOpening(ev, balance, asOf).filter(e => e.ts < cut));
  const realized = all.realizedUsd - before.realizedUsd;
  const unrealized = price != null && (liq ?? 0) >= SMART_MIN_LIQ_USD && all.costedQty > 0
    ? all.costedQty * price - all.costUsd : 0;
  return { realized, unrealized, total: realized + unrealized };
}

export function scorePool(db: DB, at = now()): Map<number, Pnl> {
  const pool = (db.prepare(`SELECT DISTINCT l.wallet_id FROM wallet_labels l JOIN wallets w ON w.id = l.wallet_id
    WHERE l.category IN ('smart', 'candidate', 'whale') AND l.valid_to IS NULL AND w.bot_at IS NULL`)
    .all() as { wallet_id: number }[]).map(r => r.wallet_id);
  const inPool = new Set(pool);
  const meta = new Map<string, { dec: number; price: number | null; liq: number | null }>();
  for (const r of db.prepare(`SELECT k.address, k.decimals, p.price_usd, p.liquidity_usd,
      (p.updated_at >= ? AND k.unpriced_at IS NULL AND NOT EXISTS (SELECT 1 FROM token_blacklist b WHERE b.address = k.address)) AS ok
    FROM tokens k LEFT JOIN prices p ON p.token = k.address`)
    .all(at - SMART_PRICE_MAX_AGE_SEC) as { address: string; decimals: number | null; price_usd: number | null; liquidity_usd: number | null; ok: number | null }[]) {
    meta.set(r.address, { dec: r.decimals ?? 18, price: r.ok ? r.price_usd : null, liq: r.liquidity_usd });
  }
  const dec = (t: string) => meta.get(t)?.dec ?? 18;

  const events = new Map<string, PosEvent[]>();
  const push = (w: number, t: string, e: PosEvent) => {
    if (!inPool.has(w)) return;
    const k = `${w}|${t}`;
    (events.get(k) ?? events.set(k, []).get(k)!).push(e);
  };
  for (const r of db.prepare(`SELECT wallet_id, token, ts, side, token_amount, usd FROM trades WHERE ts <= ? AND token != ?`).all(at, USDC) as
    { wallet_id: number; token: string; ts: number; side: 'buy' | 'sell'; token_amount: string; usd: number | null }[]) {
    push(r.wallet_id, r.token, { ts: r.ts, kind: r.side, qty: Number(r.token_amount) / 10 ** dec(r.token), usd: r.usd });
  }
  for (const r of db.prepare(`SELECT wallet_id, token, ts, direction, amount FROM transfers WHERE ts <= ? AND token != ?`).all(at, USDC) as
    { wallet_id: number; token: string; ts: number; direction: 'in' | 'out'; amount: string }[]) {
    push(r.wallet_id, r.token, { ts: r.ts, kind: r.direction, qty: Number(r.amount) / 10 ** dec(r.token), usd: null });
  }
  const balances = loadBalances(db, dec, inPool);

  const out = new Map<number, Pnl>(pool.map(id => [id, { realized: 0, unrealized: 0, total: 0 }]));
  for (const [k, ev] of events) {
    const [w, token] = k.split('|') as [string, string];
    const m = meta.get(token);
    const b = balances.get(k);
    const p = tokenPnl(ev, b?.qty, m?.price ?? null, m?.liq ?? null, at, b?.at);
    const acc = out.get(Number(w))!;
    acc.realized += p.realized; acc.unrealized += p.unrealized; acc.total += p.total;
  }
  return out;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS smart_scores (
  wallet_id INTEGER PRIMARY KEY, realized REAL NOT NULL, unrealized REAL NOT NULL, total REAL NOT NULL,
  smart INTEGER NOT NULL, scored_at INTEGER NOT NULL)`;

export function pnlTag(total: number): string {
  return total >= 999_500 ? `${(total / 1e6).toFixed(1).replace(/\.0$/, '')}M` : `${Math.round(total / 1000)}K`;
}

export function smartLabels(scores: [number, number][]): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const [id, total] of [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const base = `SMART-${pnlTag(total)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(id, n === 1 ? base : `${base}-${n}`);
  }
  return out;
}

export function smartRound(db: DB, at = now()): { pool: number; smart: number; joined: number; left: number } {
  db.exec(SCHEMA);
  const scores = scorePool(db, at);
  const openSmart = db.prepare(`SELECT 1 FROM wallet_labels WHERE wallet_id = ? AND category = 'smart' AND valid_to IS NULL`);
  const openCand = db.prepare(`SELECT 1 FROM wallet_labels WHERE wallet_id = ? AND category = 'candidate' AND valid_to IS NULL`);
  const add = db.prepare(`INSERT OR IGNORE INTO wallet_labels (wallet_id, category, label, valid_from) VALUES (?, ?, NULL, ?)`);
  const close = db.prepare(`UPDATE wallet_labels SET valid_to = ? WHERE wallet_id = ? AND category = 'smart' AND valid_to IS NULL`);
  const save = db.prepare(`INSERT OR REPLACE INTO smart_scores VALUES (?, ?, ?, ?, ?, ?)`);
  let smart = 0, joined = 0, left = 0;
  db.transaction(() => {
    for (const [id, p] of scores) {
      const ok = p.total >= SMART_MIN_PNL_USD;
      const was = !!openSmart.get(id);
      if (ok && !was) { add.run(id, 'smart', at); joined++; }
      if (!ok && was) { close.run(at, id); left++; }
      if ((ok || was) && !openCand.get(id)) add.run(id, 'candidate', at);
      if (ok) smart++;
      save.run(id, p.realized, p.unrealized, p.total, ok ? 1 : 0, at);
    }
    for (const { id } of db.prepare(`SELECT l.wallet_id AS id FROM wallet_labels l JOIN wallets w ON w.id = l.wallet_id
      WHERE l.category = 'smart' AND l.valid_to IS NULL AND w.bot_at IS NOT NULL`).all() as { id: number }[]) {
      close.run(at, id); left++;
    }
    const setLabel = db.prepare(`UPDATE wallet_labels SET label = ? WHERE wallet_id = ? AND category = 'smart' AND valid_to IS NULL`);
    const open = db.prepare(`SELECT l.wallet_id AS id FROM wallet_labels l WHERE l.category = 'smart' AND l.valid_to IS NULL`).all() as { id: number }[];
    for (const [id, label] of smartLabels(open.map(o => [o.id, scores.get(o.id)?.total ?? 0]))) setLabel.run(label, id);
  })();
  return { pool: scores.size, smart, joined, left };
}
