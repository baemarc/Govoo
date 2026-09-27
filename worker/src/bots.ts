import { num } from './config.js';
import { USDC } from './chain.js';
import { now, type DB } from './db.js';
import { removeWallet } from './wallets.js';

export const BOT_WINDOW_SEC = num('BOT_WINDOW_DAYS') * 86_400;
export const BOT_MIN_TRADES = num('BOT_MIN_TRADES');
export const BOT_PER_DAY = num('BOT_PER_DAY');
export const BOT_FAST_SEC = num('BOT_FAST_SEC');
export const BOT_FAST_PCT = num('BOT_FAST_PCT');
export const BOT_HOLD_PCT = num('BOT_HOLD_PCT');

export interface BotTrade { token: string; ts: number; side: 'buy' | 'sell'; amount: number }
export interface BotStats { n: number; perDay: number; fastPct: number; holdPct: number }

export function botStats(trades: BotTrade[], at = now()): BotStats {
  const lastBuy = new Map<string, number>();
  const net = new Map<string, number>();
  const bought = new Map<string, number>();
  let sells = 0, fast = 0;
  for (const t of trades) {
    if (t.side === 'buy') {
      lastBuy.set(t.token, t.ts);
      bought.set(t.token, (bought.get(t.token) ?? 0) + t.amount);
      net.set(t.token, (net.get(t.token) ?? 0) + t.amount);
    } else {
      sells++;
      const b = lastBuy.get(t.token);
      if (b != null && t.ts - b <= BOT_FAST_SEC) fast++;
      net.set(t.token, (net.get(t.token) ?? 0) - t.amount);
    }
  }
  const toks = [...bought.keys()];
  const held = toks.filter(k => net.get(k)! > 0.1 * bought.get(k)!).length;
  const days = Math.max(1, (at - Math.max(at - BOT_WINDOW_SEC, trades[0]?.ts ?? at)) / 86_400);
  return { n: trades.length, perDay: trades.length / days, fastPct: sells ? fast / sells : 0, holdPct: toks.length ? held / toks.length : 1 };
}

export function isBot(s: BotStats): boolean {
  return s.n >= BOT_MIN_TRADES && s.perDay >= BOT_PER_DAY && (s.fastPct >= BOT_FAST_PCT || s.holdPct < BOT_HOLD_PCT);
}

export function dropBotWhales(db: DB, at = now()): { removed: number; unlabeled: number } {
  const rows = db.prepare(
    `SELECT l.wallet_id AS id, (SELECT count(*) FROM wallet_labels o WHERE o.wallet_id = l.wallet_id AND o.valid_to IS NULL
                                AND o.category IN ('smart', 'fomo')) AS other
     FROM wallet_labels l WHERE l.category = 'whale' AND l.valid_to IS NULL`,
  ).all() as { id: number; other: number }[];
  const q = db.prepare(`SELECT t.token, t.ts, t.side, CAST(t.token_amount AS REAL) AS amount FROM trades t
    WHERE t.wallet_id = ? AND t.ts >= ? ORDER BY t.ts`);
  let removed = 0, unlabeled = 0;
  for (const r of rows) {
    const s = botStats(q.all(r.id, at - BOT_WINDOW_SEC) as BotTrade[], at);
    if (!isBot(s)) continue;
    const meta = JSON.stringify({ perDay: +s.perDay.toFixed(1), fastPct: +s.fastPct.toFixed(2), holdPct: +s.holdPct.toFixed(2) });
    if (r.other === 0) { removeWallet(db, r.id, `bot (whale) ${meta}`); removed++; continue; }
    db.transaction(() => {
      db.prepare(`UPDATE wallet_labels SET valid_to = ? WHERE wallet_id = ? AND category = 'whale' AND valid_to IS NULL`).run(at, r.id);
      db.prepare(`UPDATE wallets SET bot_at = ?, bot_meta = ? WHERE id = ?`).run(at, meta, r.id);
    })();
    unlabeled++;
  }
  return { removed, unlabeled };
}

export function markBotCandidates(db: DB, at = now()): number {
  const rows = db.prepare(
    `SELECT l.wallet_id AS id FROM wallet_labels l JOIN wallets w ON w.id = l.wallet_id
     WHERE l.category = 'candidate' AND l.valid_to IS NULL AND w.bot_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM wallet_labels o WHERE o.wallet_id = l.wallet_id AND o.valid_to IS NULL
                       AND o.category IN ('smart', 'whale', 'fomo'))`,
  ).all() as { id: number }[];
  const q = db.prepare(`SELECT token, ts, side, CAST(token_amount AS REAL) AS amount FROM trades
    WHERE wallet_id = ? AND ts >= ? ORDER BY ts`);
  const mark = db.prepare(`UPDATE wallets SET bot_at = ?, bot_meta = ? WHERE id = ?`);
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const s = botStats(q.all(r.id, at - BOT_WINDOW_SEC) as BotTrade[], at);
      if (!isBot(s)) continue;
      mark.run(at, JSON.stringify({ perDay: +s.perDay.toFixed(1), fastPct: +s.fastPct.toFixed(2), holdPct: +s.holdPct.toFixed(2) }), r.id);
      n++;
    }
  })();
  return n;
}

export const SYBIL_MIN_WALLETS = num('SYBIL_MIN_WALLETS');
export const SYBIL_MIN_SHARE = num('SYBIL_MIN_SHARE');

export function sybilTokens(single: Map<string, number>, traders: Map<string, number>): Set<string> {
  const out = new Set<string>();
  for (const [token, n] of single) {
    if (n >= SYBIL_MIN_WALLETS && n / (traders.get(token) ?? n) >= SYBIL_MIN_SHARE) out.add(token);
  }
  return out;
}

export function markSybilClusters(db: DB, at = now()): { tokens: string[]; wallets: number } {
  const rows = db.prepare(
    `SELECT t.wallet_id AS id, group_concat(DISTINCT t.token) AS toks FROM trades t JOIN wallets w ON w.id = t.wallet_id
     WHERE t.token != ? GROUP BY t.wallet_id`,
  ).all(USDC) as { id: number; toks: string }[];
  const single = new Map<string, number>();
  const traders = new Map<string, number>();
  const sets = new Map<number, string[]>();
  for (const r of rows) {
    const toks = r.toks.split(',');
    sets.set(r.id, toks);
    for (const t of toks) traders.set(t, (traders.get(t) ?? 0) + 1);
    if (toks.length === 1) single.set(toks[0]!, (single.get(toks[0]!) ?? 0) + 1);
  }
  const bad = sybilTokens(single, traders);
  if (!bad.size) return { tokens: [], wallets: 0 };

  const eligible = db.prepare(
    `SELECT w.id FROM wallets w WHERE w.source = 'cand-scan' AND w.bot_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM wallet_labels o WHERE o.wallet_id = w.id AND o.valid_to IS NULL AND o.category IN ('whale', 'fomo'))`,
  ).all() as { id: number }[];
  const sym = db.prepare(`SELECT symbol FROM tokens WHERE address = ?`);
  const name = (t: string) => (sym.get(t) as { symbol: string | null } | undefined)?.symbol ?? t.slice(0, 10);
  const mark = db.prepare(`UPDATE wallets SET bot_at = ?, bot_meta = ? WHERE id = ?`);
  let n = 0;
  db.transaction(() => {
    for (const { id } of eligible) {
      const toks = sets.get(id);
      if (!toks?.length || !toks.every(t => bad.has(t))) continue;
      mark.run(at, JSON.stringify({ sybil: toks.length === 1 ? name(toks[0]!) : `only-${toks.map(name).join('/')}`, rule: 'auto' }), id);
      n++;
    }
  })();
  return { tokens: [...bad].map(name), wallets: n };
}
