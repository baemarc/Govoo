import { MIN_TRADE_USD, USDC } from '../chain.js';
import { now, type DB } from '../db.js';
import { fetchMarkets } from './dexscreener.js';
import { insertPool, poolsOf, readPools, savePoolReads, syncPools, type PoolRead } from './pools.js';
import { dsVerdict, pickBest } from './poolRules.js';
import { refreshTokenMeta } from './tokenMeta.js';

const MONTH = 31 * 86_400;
const COLD_SLICES = 12;

export function tokenUniverse(db: DB): string[] {
  const since = now() - MONTH;
  return (db.prepare(
    `SELECT token FROM trades WHERE ts > @since UNION SELECT token FROM transfers WHERE ts > @since`,
  ).all({ since }) as { token: string }[])
    .map(r => r.token)
    .filter(t => t !== USDC)
    .filter(t => !db.prepare(`SELECT 1 FROM token_blacklist WHERE address = ?`).get(t))
    .filter(t => !db.prepare(`SELECT 1 FROM tokens WHERE address = ? AND unpriced_at > ?`).get(t, now() - UNPRICED_RETRY));
}

const HOT_LIQ = 1000;
const DS_CHECK_PER_ROUND = Number(process.env.DS_CHECK_PER_ROUND ?? 300);
const DS_NOQUOTE_PER_ROUND = Number(process.env.DS_NOQUOTE_PER_ROUND ?? 600);
const UNPRICED_RETRY = 86_400;

export function splitHot(db: DB, tokens: string[], at = now()): { hot: string[]; cold: string[] } {
  const liquid = new Set((db.prepare(`SELECT token FROM prices WHERE price_usd IS NOT NULL AND liquidity_usd >= ?`).all(HOT_LIQ) as { token: string }[]).map(r => r.token));
  const recent = new Set((db.prepare(`SELECT DISTINCT token FROM trades WHERE ts > ?`).all(at - 86_400) as { token: string }[]).map(r => r.token));
  const hot: string[] = [], cold: string[] = [];
  for (const t of tokens) (liquid.has(t) || recent.has(t) ? hot : cold).push(t);
  return { hot, cold };
}

interface Quote { token: string; priceUsd: number; mcapUsd: number | null; liquidityUsd: number | null; pool: string | null; createdAt: number | null }

export async function priceRound(db: DB): Promise<{ tokens: number; asked: number; pools: number; newPools: number; chain: number; dex: number; checked: number; added: number; prefer: number; unpriced: number; filled: number }> {
  const tokens = tokenUniverse(db);
  await refreshTokenMeta(db, tokens);
  const newPools = await syncPools(db);
  const { hot, cold } = splitHot(db, tokens);
  const slice = (db.prepare(`SELECT block FROM cursor WHERE name = 'price_cold_slice'`).get() as { block: number } | undefined)?.block ?? 0;
  const added = new Set((db.prepare(`SELECT DISTINCT token FROM pools WHERE block = 0 AND read_at IS NULL`).all() as { token: string }[]).map(r => r.token));
  const prefer = new Set((db.prepare(`SELECT address FROM tokens WHERE ds_prefer = 1`).all() as { address: string }[]).map(r => r.address));
  const ask = [...new Set([...hot, ...added, ...prefer, ...cold.sort().filter((_, i) => i % COLD_SLICES === slice % COLD_SLICES)])];
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('price_cold_slice', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`)
    .run((slice + 1) % COLD_SLICES);

  const meta = new Map((db.prepare(`SELECT address, decimals, total_supply FROM tokens`).all() as
    { address: string; decimals: number | null; total_supply: string | null }[]).map(r => [r.address, r]));
  const pools = poolsOf(db, ask);
  const reads = await readPools(pools, new Map([...meta].map(([a, m]) => [a, m.decimals])));
  savePoolReads(db, reads);
  const created = new Map(pools.map(p => [p.id, p.ts]));
  const byToken = new Map<string, PoolRead[]>();
  for (const r of reads) if (r.liquidityUsd > 0) (byToken.get(r.token) ?? byToken.set(r.token, []).get(r.token)!).push(r);

  const quotes = new Map<string, Quote>();
  for (const [token, rs] of byToken) {
    const b = pickBest(rs.map(r => ({ id: r.id, priceUsd: r.priceUsd, liquidityUsd: r.liquidityUsd })))!;
    const m = meta.get(token);
    const supply = m?.total_supply != null && m.decimals != null ? Number(m.total_supply) / 10 ** m.decimals : null;
    quotes.set(token, {
      token, priceUsd: b.priceUsd, liquidityUsd: b.liquidityUsd, pool: b.id, createdAt: created.get(b.id) ?? null,
      mcapUsd: supply != null && Number.isFinite(supply * b.priceUsd) ? supply * b.priceUsd : null,
    });
  }
  const chain = quotes.size;

  const hotSet = new Set(hot);
  const dsPrice = ask.filter(t => prefer.has(t) || (hotSet.has(t) && !quotes.has(t)));
  const dsCheck = (db.prepare(
    `SELECT k.address FROM tokens k JOIN prices p ON p.token = k.address
     WHERE p.price_usd IS NOT NULL AND (k.ds_checked_at IS NULL OR k.ds_checked_at < ?)
     ORDER BY p.liquidity_usd DESC LIMIT ?`,
  ).all(now() - 86_400, DS_CHECK_PER_ROUND) as { address: string }[]).map(r => r.address);
  const dsFresh = db.prepare(`SELECT 1 FROM tokens WHERE address = ? AND ds_checked_at >= ?`);
  const noQuote = ask.filter(t => !quotes.has(t) && !prefer.has(t) && !dsCheck.includes(t) && !dsFresh.get(t, now() - 86_400))
    .slice(0, DS_NOQUOTE_PER_ROUND);
  dsCheck.push(...noQuote);
  const markets = await fetchMarkets([...new Set([...dsPrice, ...dsCheck])]);
  let dex = 0;
  for (const t of dsPrice) {
    const m = markets.get(t);
    if (!m || m.priceUsd == null) continue;
    quotes.set(t, { token: t, priceUsd: m.priceUsd, mcapUsd: m.mcapUsd, liquidityUsd: m.liquidityUsd, pool: null, createdAt: m.pairCreatedAt });
    dex++;
  }

  const t = now();
  const hour = t - (t % 3600);
  const ago = db.prepare(`SELECT price_usd FROM price_history WHERE token = ? AND hour BETWEEN ? AND ? ORDER BY abs(hour - ?) LIMIT 1`);
  const upPrice = db.prepare(
    `INSERT INTO prices (token, price_usd, mcap_usd, liquidity_usd, change_24h, updated_at, source, pool) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET price_usd = excluded.price_usd, mcap_usd = excluded.mcap_usd,
       liquidity_usd = excluded.liquidity_usd, change_24h = excluded.change_24h, updated_at = excluded.updated_at,
       source = excluded.source, pool = excluded.pool`,
  );
  const upHist = db.prepare(`INSERT OR IGNORE INTO price_history (token, hour, price_usd) VALUES (?, ?, ?)`);
  const upCreated = db.prepare(`UPDATE tokens SET pair_created_at = coalesce(pair_created_at, ?) WHERE address = ?`);
  const upMeta = db.prepare(
    `UPDATE tokens SET symbol = coalesce(symbol, ?), name = coalesce(name, ?), logo_url = coalesce(?, logo_url),
       ds_checked_at = ?, ds_prefer = ? WHERE address = ?`,
  );
  const known = db.prepare(`SELECT id, liquidity_usd FROM pools WHERE token = ?`);
  const clearUnpriced = db.prepare(`UPDATE tokens SET unpriced_at = NULL WHERE address = ? AND unpriced_at IS NOT NULL`);
  const redo = db.prepare(`UPDATE trades SET dirty_at = ? WHERE token = ? AND ts > ?`);
  const markUnpriced = db.prepare(`UPDATE tokens SET unpriced_at = ? WHERE address = ?`);
  const addedOrPrefer = new Set<string>();
  let addedPools = 0, preferred = 0, unpriced = 0;
  db.transaction(() => {
    for (const q of quotes.values()) {
      const d = t - 86_400;
      const prev = ago.get(q.token, d - 3600, d + 3600, d) as { price_usd: number } | undefined;
      const change = prev && prev.price_usd > 0 ? (q.priceUsd / prev.price_usd - 1) * 100 : null;
      upPrice.run(q.token, q.priceUsd, q.mcapUsd, q.liquidityUsd, change, t, q.pool ? 'chain' : 'dexscreener', q.pool);
      upHist.run(q.token, hour, q.priceUsd);
      upCreated.run(q.createdAt, q.token);
    }
    for (const a of dsCheck) {
      const m = markets.get(a);
      const rows = known.all(a) as { id: string; liquidity_usd: number | null }[];
      const best = rows.reduce<number | null>((x, r) => r.liquidity_usd == null ? x : Math.max(x ?? 0, r.liquidity_usd), null);
      const v = dsVerdict(a, m, new Set(rows.map(r => r.id)), best);
      if (v.kind === 'add') addedPools += insertPool(db, v.pool);
      if (v.kind === 'prefer') preferred++;
      upMeta.run(m?.symbol ?? null, m?.name ?? null, m?.logoUrl ?? null, t, v.kind === 'prefer' ? 1 : 0, a);
      if (v.kind !== 'ok') addedOrPrefer.add(a);
    }
    for (const a of ask) {
      if (quotes.has(a)) { if (clearUnpriced.run(a).changes) redo.run(t, a, t - MONTH); continue; }
      if (addedOrPrefer.has(a) || prefer.has(a) || !dsFresh.get(a, t - 86_400)) continue;
      unpriced += markUnpriced.run(t, a).changes;
    }
  })();
  return { tokens: tokens.length, asked: ask.length, pools: pools.length, newPools, chain, dex, checked: dsCheck.length, added: addedPools, prefer: preferred, unpriced, filled: fillMissingUsd(db) };
}

export function fillMissingUsd(db: DB): number {
  const rows = db.prepare(
    `SELECT t.tx_hash, t.wallet_id, t.token, t.ts, t.token_amount, k.decimals FROM trades t
     JOIN tokens k ON k.address = t.token WHERE t.usd IS NULL AND k.decimals IS NOT NULL`,
  ).all() as { tx_hash: string; wallet_id: number; token: string; ts: number; token_amount: string; decimals: number }[];
  const near = db.prepare(
    `SELECT price_usd FROM price_history WHERE token = ? AND hour BETWEEN ? AND ? ORDER BY abs(hour - ?) LIMIT 1`,
  );
  const set = db.prepare(`UPDATE trades SET usd = ?, below_floor = ?, dirty_at = ? WHERE tx_hash = ? AND wallet_id = ? AND token = ?`);
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const p = near.get(r.token, r.ts - 7200, r.ts + 7200, r.ts) as { price_usd: number } | undefined;
      if (!p) continue;
      const usd = (Number(r.token_amount) / 10 ** r.decimals) * p.price_usd;
      set.run(usd, usd < MIN_TRADE_USD ? 1 : 0, now(), r.tx_hash, r.wallet_id, r.token);
      n++;
    }
  })();
  return n;
}
