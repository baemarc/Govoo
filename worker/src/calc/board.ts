import { USDC } from '../chain.js';
import { now, type DB } from '../db.js';
import { heldAt, replay, type PosEvent, type Position } from './positions.js';

export const WINDOWS: Record<string, number> = {
  '15m': 900, '1h': 3600, '4h': 14_400, '8h': 28_800, '12h': 43_200,
  '24h': 86_400, '3d': 259_200, '1w': 604_800, '1m': 2_592_000,
};
export const CATEGORIES = ['smart', 'whale', 'fomo', 'all'] as const;
type Cat = 'smart' | 'whale' | 'fomo';
const RANK: Record<string, number> = { fomo: 3, smart: 2, whale: 1 };
const MIN_TRADES_FOR_SHARE = 3;
const WHO_TOP = 5;
const ROTATION_TOP = 100;
const ROTATION_MIN_USD = 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calc_board (
  token TEXT NOT NULL, win TEXT NOT NULL, category TEXT NOT NULL,
  inflow REAL NOT NULL, outflow REAL NOT NULL, net REAL NOT NULL,
  buyers INTEGER NOT NULL, sellers INTEGER NOT NULL, trades INTEGER NOT NULL,
  top_share REAL, holders INTEGER NOT NULL, holders_delta INTEGER NOT NULL,
  sm_usd REAL, supply_pct REAL, who TEXT NOT NULL, holders_cat TEXT,
  PRIMARY KEY (token, win, category)
);
CREATE TABLE IF NOT EXISTS calc_rotations (
  win TEXT NOT NULL, from_token TEXT NOT NULL, to_token TEXT NOT NULL, usd REAL NOT NULL,
  PRIMARY KEY (win, from_token, to_token)
);
CREATE TABLE IF NOT EXISTS calc_usdc_series (
  ts INTEGER NOT NULL, category TEXT NOT NULL, usd REAL NOT NULL,
  PRIMARY KEY (ts, category)
);
CREATE TABLE IF NOT EXISTS calc_positions (
  wallet_id INTEGER NOT NULL, token TEXT NOT NULL,
  qty REAL NOT NULL, costed_qty REAL NOT NULL, cost_usd REAL NOT NULL, costless_qty REAL NOT NULL,
  realized_usd REAL NOT NULL, value_usd REAL,
  PRIMARY KEY (wallet_id, token)
);`;

interface Label { category: string; label: string | null; from: number; to: number | null }
interface Trade { wallet_id: number; token: string; ts: number; side: 'buy' | 'sell'; qty: number; usd: number | null; below_floor: number; tx_hash: string; counter: string }

export function categoryAt(labels: Label[] | undefined, ts: number): Cat | null {
  let best: Label | null = null;
  for (const l of labels ?? []) {
    if (!(l.category in RANK) || l.from > ts || (l.to != null && ts >= l.to)) continue;
    if (!best || RANK[l.category]! > RANK[best.category]!) best = l;
  }
  return (best?.category as Cat) ?? null;
}

export function publicLabel(labels: Label[] | undefined, cat: Cat): string {
  if (cat === 'smart') return 'Smart Wallet';
  const l = (labels ?? []).find(x => x.category === cat && x.to == null);
  return l?.label ?? (cat === 'whale' ? 'Whale' : 'Fomo');
}

export function rotations(trades: { wallet_id: number; token: string; side: string; usd: number }[]): Map<string, number> {
  const byWallet = new Map<number, { sell: Map<string, number>; buy: Map<string, number> }>();
  for (const t of trades) {
    let w = byWallet.get(t.wallet_id);
    if (!w) byWallet.set(t.wallet_id, (w = { sell: new Map(), buy: new Map() }));
    const m = t.side === 'sell' ? w.sell : w.buy;
    m.set(t.token, (m.get(t.token) ?? 0) + t.usd);
  }
  const out = new Map<string, number>();
  for (const { sell, buy } of byWallet.values()) {
    const S = [...sell.values()].reduce((a, b) => a + b, 0);
    const B = [...buy.values()].reduce((a, b) => a + b, 0);
    if (!S || !B) continue;
    const scale = Math.min(S, B);
    for (const [a, sa] of sell) for (const [b, bb] of buy) {
      if (a === b) continue;
      const k = `${a}>${b}`;
      out.set(k, (out.get(k) ?? 0) + scale * (sa / S) * (bb / B));
    }
  }
  return out;
}

export function withOpening(ev: PosEvent[], balance: number | undefined, asOf = Infinity): PosEvent[] {
  if (balance == null) return ev;
  const net = ev.reduce((a, e) => e.ts > asOf ? a : a + (e.kind === 'buy' || e.kind === 'in' ? e.qty : -e.qty), 0);
  const opening = balance - net;
  return opening > balance * 1e-6 ? [{ ts: 0, kind: 'in' as const, qty: opening, usd: null }, ...ev] : ev;
}

export function reconcile(ev: PosEvent[], balance: number | undefined, at: number, asOf = at): Position {
  if (balance == null) return replay(ev);
  const list = withOpening(ev, balance, asOf);
  const then = replay(list.filter(e => e.ts <= asOf));
  if (then.qty > balance * (1 + 1e-6)) {
    return replay([...list, { ts: asOf, kind: 'out', qty: then.qty - balance, usd: null }]);
  }
  return replay(list);
}

export interface Balance { qty: number; at: number }

export function loadBalances(db: DB, dec: (token: string) => number, keep?: Set<number>): Map<string, Balance> {
  const out = new Map<string, Balance>();
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'token_balances'`).get()) return out;
  for (const r of db.prepare(`SELECT wallet_id, token, balance, checked_at FROM token_balances`).all() as
    { wallet_id: number; token: string; balance: string; checked_at: number }[]) {
    if (keep && !keep.has(r.wallet_id)) continue;
    out.set(`${r.wallet_id}|${r.token}`, { qty: Number(r.balance) / 10 ** dec(r.token), at: r.checked_at });
  }
  return out;
}

export function computeBoard(db: DB, at = now()): { board: number; rotations: number; positions: number } {
  db.exec(SCHEMA);
  if (!(db.prepare(`SELECT 1 FROM pragma_table_info('calc_board') WHERE name = 'holders_cat'`).get())) {
    db.exec(`ALTER TABLE calc_board ADD COLUMN holders_cat TEXT`);
  }

  const labels = new Map<number, Label[]>();
  for (const r of db.prepare(`SELECT wallet_id, category, label, valid_from, valid_to FROM wallet_labels`).all() as
    { wallet_id: number; category: string; label: string | null; valid_from: number; valid_to: number | null }[]) {
    (labels.get(r.wallet_id) ?? labels.set(r.wallet_id, []).get(r.wallet_id)!).push(
      { category: r.category, label: r.label, from: r.valid_from, to: r.valid_to });
  }

  const meta = new Map<string, { dec: number; supply: number | null; price: number | null }>();
  for (const r of db.prepare(`SELECT k.address, k.decimals, k.total_supply, p.price_usd FROM tokens k
    LEFT JOIN prices p ON p.token = k.address`).all() as { address: string; decimals: number | null; total_supply: string | null; price_usd: number | null }[]) {
    const dec = r.decimals ?? 18;
    meta.set(r.address, { dec, supply: r.total_supply ? Number(r.total_supply) / 10 ** dec : null, price: r.price_usd });
  }
  const blocked = new Set((db.prepare(`SELECT address FROM token_blacklist UNION SELECT address FROM tokens WHERE unpriced_at IS NOT NULL`)
    .all() as { address: string }[]).map(r => r.address));
  const dec = (t: string) => meta.get(t)?.dec ?? 18;

  const trades = (db.prepare(`SELECT wallet_id, token, ts, side, token_amount, usd, below_floor, tx_hash, counter FROM trades WHERE ts <= ?`).all(at) as
    { wallet_id: number; token: string; ts: number; side: 'buy' | 'sell'; token_amount: string; usd: number | null; below_floor: number; tx_hash: string; counter: string }[])
    .map(r => ({ ...r, qty: Number(r.token_amount) / 10 ** dec(r.token) })) as Trade[];
  const events = new Map<string, PosEvent[]>();
  const push = (w: number, t: string, e: PosEvent) => {
    const k = `${w}|${t}`;
    (events.get(k) ?? events.set(k, []).get(k)!).push(e);
  };
  for (const t of trades) push(t.wallet_id, t.token, { ts: t.ts, kind: t.side, qty: t.qty, usd: t.usd });
  for (const r of db.prepare(`SELECT wallet_id, token, ts, direction, amount FROM transfers WHERE token != ? AND ts <= ?`).all(USDC, at) as
    { wallet_id: number; token: string; ts: number; direction: 'in' | 'out'; amount: string }[]) {
    push(r.wallet_id, r.token, { ts: r.ts, kind: r.direction, qty: Number(r.amount) / 10 ** dec(r.token), usd: null });
  }
  const live = at >= now() - 900;
  const balances = live ? loadBalances(db, dec) : new Map<string, Balance>();

  const byToken = new Map<string, { wallet: number; pos: Position }[]>();
  const posRows: unknown[][] = [];
  for (const [k, ev] of events) {
    const [w, token] = k.split('|') as [string, string];
    const b = balances.get(k);
    const pos = reconcile(ev, b?.qty, at, b?.at);
    (byToken.get(token) ?? byToken.set(token, []).get(token)!).push({ wallet: Number(w), pos });
    if (pos.qty > 0 && !blocked.has(token)) {
      const price = meta.get(token)?.price;
      posRows.push([Number(w), token, pos.qty, pos.costedQty, pos.costUsd, pos.costlessQty, pos.realizedUsd,
        price != null ? pos.qty * price : null]);
    }
  }

  const boardRows: unknown[][] = [];
  const rotRows: unknown[][] = [];
  for (const [win, secs] of Object.entries(WINDOWS)) {
    const since = at - secs;
    const inWin = trades.filter(t => t.ts > since && t.ts <= at && !t.below_floor && t.usd != null
      && t.token !== USDC && !blocked.has(t.token));
    const cat = new Map<Trade, Cat | null>(inWin.map(t => [t, categoryAt(labels.get(t.wallet_id), t.ts)]));

    for (const c of CATEGORIES) {
      const rows = inWin.filter(t => (c === 'all' ? cat.get(t) != null : cat.get(t) === c));
      const tokens = new Map<string, Trade[]>();
      for (const t of rows) (tokens.get(t.token) ?? tokens.set(t.token, []).get(t.token)!).push(t);

      for (const [token, ts] of tokens) {
        const inflow = ts.filter(t => t.side === 'buy').reduce((a, t) => a + t.usd!, 0);
        const outflow = ts.filter(t => t.side === 'sell').reduce((a, t) => a + t.usd!, 0);
        const buyers = new Set(ts.filter(t => t.side === 'buy').map(t => t.wallet_id)).size;
        const sellers = new Set(ts.filter(t => t.side === 'sell').map(t => t.wallet_id)).size;
        const top = ts.length >= MIN_TRADES_FOR_SHARE ? Math.max(...ts.map(t => t.usd!)) / (inflow + outflow) : null;

        const m = meta.get(token);
        const inCat = (w: number, t: number) => {
          const k = categoryAt(labels.get(w), t);
          return c === 'all' ? k != null : k === c;
        };
        const holdersNow = (byToken.get(token) ?? []).filter(h => heldAt(h.pos, at) && inCat(h.wallet, at));
        const holdersThen = (byToken.get(token) ?? []).filter(h => heldAt(h.pos, since) && inCat(h.wallet, since)).length;
        const qty = holdersNow.reduce((a, h) => a + h.pos.qty, 0);
        const smUsd = m?.price != null ? qty * m.price : null;
        const supplyPct = m?.supply ? (qty / m.supply) * 100 : null;
        const who = holdersNow
          .map(h => ({ id: h.wallet, cat: categoryAt(labels.get(h.wallet), at)!, qty: h.pos.qty }))
          .sort((a, b) => b.qty - a.qty).slice(0, WHO_TOP)
          .map(h => ({ id: h.id, l: publicLabel(labels.get(h.id), h.cat), c: h.cat,
            usd: m?.price != null ? h.qty * m.price : null }));
        let holdersCat: string | null = null;
        if (c === 'all') {
          const n: Record<Cat, number> = { smart: 0, whale: 0, fomo: 0 };
          for (const h of holdersNow) n[categoryAt(labels.get(h.wallet), at)!]++;
          holdersCat = JSON.stringify(n);
        }

        boardRows.push([token, win, c, inflow, outflow, inflow - outflow, buyers, sellers, ts.length, top,
          holdersNow.length, holdersNow.length - holdersThen, smUsd, supplyPct, JSON.stringify(who), holdersCat]);
      }
    }

    const rot = [...rotations(inWin.filter(t => cat.get(t) != null).map(t => ({ ...t, usd: t.usd! })))]
      .filter(([, usd]) => usd >= ROTATION_MIN_USD).sort((a, b) => b[1] - a[1]).slice(0, ROTATION_TOP);
    for (const [k, usd] of rot) {
      const [a, b] = k.split('>');
      rotRows.push([win, a, b, usd]);
    }
  }

  const usdc = new Map<string, number>();
  if (live && db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'usdc_balances'`).get()) {
    for (const r of db.prepare(`SELECT wallet_id, balance FROM usdc_balances`).all() as { wallet_id: number; balance: string }[]) {
      const c = categoryAt(labels.get(r.wallet_id), at);
      if (!c || c === 'fomo') continue;
      const usd = Number(r.balance) / 1e18;
      usdc.set(c, (usdc.get(c) ?? 0) + usd);
      usdc.set('all', (usdc.get('all') ?? 0) + usd);
    }
  }

  db.transaction(() => {
    db.exec(`DELETE FROM calc_board; DELETE FROM calc_rotations; DELETE FROM calc_positions;`);
    const slot = at - (at % 300);
    const iu = db.prepare(`INSERT OR REPLACE INTO calc_usdc_series VALUES (?, ?, ?)`);
    for (const [c, usd] of usdc) iu.run(slot, c, usd);
    db.prepare(`DELETE FROM calc_usdc_series WHERE ts < ?`).run(at - 35 * 86_400);
    const ib = db.prepare(`INSERT INTO calc_board (token, win, category, inflow, outflow, net, buyers, sellers, trades,
      top_share, holders, holders_delta, sm_usd, supply_pct, who, holders_cat) VALUES (${Array(16).fill('?').join(',')})`);
    for (const r of boardRows) ib.run(...r);
    const ir = db.prepare(`INSERT INTO calc_rotations VALUES (?, ?, ?, ?)`);
    for (const r of rotRows) ir.run(...r);
    const ip = db.prepare(`INSERT INTO calc_positions VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of posRows) ip.run(...r);
  })();
  return { board: boardRows.length, rotations: rotRows.length, positions: posRows.length };
}
