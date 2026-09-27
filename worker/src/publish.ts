import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MAINNET_START_BLOCK, MIN_TRADE_USD } from './chain.js';
import { required } from './config.js';
import { now, type DB } from './db.js';
import { categoryAt, publicLabel } from './calc/board.js';
import { addWallet, removeWallet, unblacklistWallet } from './wallets.js';
import { displaySymbol } from './market/symbol.js';

const CHUNK = 1000;
const TRADE_DAYS = 31;
const EARLY_START_BLOCK = 7_943_803;

let sb: SupabaseClient | null = null;
function client(): SupabaseClient {
  sb ??= createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  return sb;
}

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`supabase ${what}: ${error.message}`);
  return data;
}

async function upsert(table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await check(client().from(table).upsert(rows.slice(i, i + CHUNK), { onConflict }), `${table} upsert`);
  }
}

export const tradeId = (key: string, tx: string, walletId: number, token: string) =>
  createHmac('sha256', key).update(`${tx}|${walletId}|${token}`).digest('hex').slice(0, 32);

const iso = (ts: number) => new Date(ts * 1000).toISOString();

const COARSE_SEC = 300;
const coarseTs = (ts: number) => iso(Math.floor(ts / COARSE_SEC) * COARSE_SEC);
const sig = (x: number) => Number(x.toPrecision(3));
const sigN = (x: number | null | undefined) => (x == null ? null : sig(x));

async function syncWhaleTokens(db: DB): Promise<void> {
  const remote = await check(client().from('whale_tokens').select('token, symbol, added_at'), 'whale_tokens') as
    { token: string; symbol: string | null; added_at: string }[];
  const synced = db.prepare(`SELECT 1 FROM cursor WHERE name = 'whale_tokens_synced'`).get();
  if (!synced && !remote.length) {
    const local = db.prepare(`SELECT token, symbol, added_at FROM whale_tokens`).all() as { token: string; symbol: string | null; added_at: number }[];
    await upsert('whale_tokens', local.map(r => ({ ...r, added_at: iso(r.added_at) })), 'token');
  } else {
    const keep = new Set(remote.map(r => r.token.toLowerCase()));
    db.transaction(() => {
      const ins = db.prepare(`INSERT INTO whale_tokens (token, symbol, added_at) VALUES (?, ?, ?) ON CONFLICT(token) DO NOTHING`);
      for (const r of remote) ins.run(r.token.toLowerCase(), r.symbol, Math.floor(Date.parse(r.added_at) / 1000));
      for (const { token } of db.prepare(`SELECT token FROM whale_tokens`).all() as { token: string }[]) {
        if (!keep.has(token)) db.prepare(`DELETE FROM whale_tokens WHERE token = ?`).run(token);
      }
    })();
  }
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('whale_tokens_synced', ?) ON CONFLICT(name) DO NOTHING`).run(now());
}

async function publishWhaleTokens(db: DB): Promise<void> {
  const rows = db.prepare(`SELECT token, symbol, last_scanned_at, whale_count FROM whale_tokens WHERE last_scanned_at IS NOT NULL`)
    .all() as { token: string; symbol: string | null; last_scanned_at: number; whale_count: number }[];
  for (const r of rows) {
    await check(client().from('whale_tokens').update({ symbol: r.symbol, last_scanned_at: iso(r.last_scanned_at),
      whale_count: r.whale_count }).eq('token', r.token), 'whale_tokens update');
  }
}

async function applyAdmin(db: DB): Promise<void> {
  await syncWhaleTokens(db);
  const tb = await check(client().from('token_blacklist').select('address, reason'), 'token_blacklist');
  db.transaction(() => {
    db.exec(`DELETE FROM token_blacklist`);
    const ins = db.prepare(`INSERT INTO token_blacklist (address, reason, added_at) VALUES (?, ?, ?)`);
    for (const r of tb as { address: string; reason: string | null }[]) ins.run(r.address.toLowerCase(), r.reason, now());
  })();

  const reqs = await check(client().from('wallet_requests').select('*').order('id'), 'wallet_requests') as
    { id: number; action: 'add' | 'remove' | 'restore'; address: string; category: 'smart' | 'whale' | 'fomo' | null; label: string | null }[];
  for (const r of reqs) {
    const addr = r.address.toLowerCase();
    if (r.action === 'remove') {
      const w = db.prepare(`SELECT id FROM wallets WHERE address = ?`).get(addr) as { id: number } | undefined;
      if (w) {
        removeWallet(db, w.id, 'admin');
        for (const t of ['trades', 'positions', 'wallets_public', 'wallets_admin']) {
          await check(client().from(t).delete().eq('wallet_id', w.id), `${t} delete`);
        }
      }
      await check(client().from('wallet_blacklist').upsert({ address: addr, reason: 'admin' }), 'wallet_blacklist');
    } else if (r.action === 'restore') {
      unblacklistWallet(db, addr);
      await check(client().from('wallet_blacklist').delete().eq('address', addr), 'wallet_blacklist delete');
      if (r.category) addWallet(db, addr, r.category, r.label, r.category === 'smart' ? EARLY_START_BLOCK : MAINNET_START_BLOCK);
    } else if (r.category) {
      addWallet(db, addr, r.category, r.label, r.category === 'smart' ? EARLY_START_BLOCK : MAINNET_START_BLOCK);
    }
    await check(client().from('wallet_requests').delete().eq('id', r.id), 'wallet_requests delete');
  }
}

async function sweepRemoved(local: Set<number>): Promise<number> {
  const remote: number[] = [];
  for (let from = 0; ; from += CHUNK) {
    const page = await check(client().from('wallets_admin').select('wallet_id').order('wallet_id').range(from, from + CHUNK - 1),
      'wallets_admin') as { wallet_id: number }[];
    remote.push(...page.map(r => r.wallet_id));
    if (page.length < CHUNK) break;
  }
  const gone = remote.filter(id => !local.has(id));
  for (let i = 0; i < gone.length; i += 200) {
    const ids = gone.slice(i, i + 200);
    for (const t of ['trades', 'positions', 'wallets_public', 'wallets_admin']) {
      await check(client().from(t).delete().in('wallet_id', ids), `${t} sweep`);
    }
  }
  return gone.length;
}

export async function publish(db: DB, lastBlock: number): Promise<{ trades: number; board: number }> {
  const key = required('SONARC_HMAC_KEY');
  const t = now();
  await applyAdmin(db);

  const labelRows = db.prepare(`SELECT wallet_id, category, label, valid_from, valid_to FROM wallet_labels`).all() as
    { wallet_id: number; category: string; label: string | null; valid_from: number; valid_to: number | null }[];
  const labels = new Map<number, { category: string; label: string | null; from: number; to: number | null }[]>();
  for (const r of labelRows) {
    (labels.get(r.wallet_id) ?? labels.set(r.wallet_id, []).get(r.wallet_id)!)
      .push({ category: r.category, label: r.label, from: r.valid_from, to: r.valid_to });
  }
  const wallets = db.prepare(`SELECT id, address, source, added_at FROM wallets`).all() as
    { id: number; address: string; source: string; added_at: number }[];
  const pub: object[] = [];
  const adm: object[] = [];
  const current = new Set<number>();
  const lapsed: number[] = [];
  for (const w of wallets) {
    const cat = categoryAt(labels.get(w.id), t);
    if (!cat) { lapsed.push(w.id); continue; }
    current.add(w.id);
    pub.push({ wallet_id: w.id, category: cat, label: publicLabel(labels.get(w.id), cat) });
    const own = labels.get(w.id)?.find(x => x.category === cat && x.to == null)?.label ?? null;
    adm.push({ wallet_id: w.id, address: w.address, source: w.source, added_at: iso(w.added_at), label: own });
  }
  await upsert('wallets_public', pub, 'wallet_id');
  await upsert('wallets_admin', adm, 'wallet_id');
  await sweepRemoved(new Set(wallets.map(w => w.id)));
  for (let i = 0; i < lapsed.length; i += 200) {
    await check(client().from('wallets_public').delete().in('wallet_id', lapsed.slice(i, i + 200)), 'wallets_public lapsed');
  }

  const tokens = db.prepare(
    `SELECT k.address, k.symbol, k.name, k.decimals, k.logo_url, k.pair_created_at, k.total_supply,
            p.price_usd, p.mcap_usd, p.liquidity_usd, p.change_24h
     FROM tokens k LEFT JOIN prices p ON p.token = k.address
     WHERE k.address IN (SELECT token FROM calc_board UNION SELECT token FROM calc_positions)`,
  ).all() as { address: string; symbol: string | null; name: string | null; decimals: number | null; total_supply: string | null;
    pair_created_at: number | null }[];
  await upsert('tokens', tokens.map(k => ({
    ...k,
    symbol: displaySymbol(k.address, k.symbol, k.name),
    pair_created_at: k.pair_created_at ? iso(k.pair_created_at) : null,
    total_supply: k.total_supply ? Number(k.total_supply) / 10 ** (k.decimals ?? 18) : null,
    updated_at: iso(t),
  })), 'address');

  const mark = (db.prepare(`SELECT block FROM cursor WHERE name = 'pub_trades_v2'`).get() as { block: number } | undefined)?.block ?? 0;
  const dirtySince = (db.prepare(`SELECT block FROM cursor WHERE name = 'pub_trades_dirty'`).get() as { block: number } | undefined)?.block ?? 0;
  const cols = `SELECT t.rowid AS rid, t.tx_hash, t.wallet_id, t.token, t.side, t.token_amount, t.usd, t.ts, t.below_floor, t.via,
            coalesce(k.decimals, 18) AS dec
     FROM trades t LEFT JOIN tokens k ON k.address = t.token`;
  type Row = { rid: number; tx_hash: string; wallet_id: number; token: string; side: string; token_amount: string; usd: number | null;
    ts: number; below_floor: number; via: string; dec: number };
  const rows = db.prepare(`${cols} WHERE t.rowid > ? AND t.ts > ? AND k.unpriced_at IS NULL ORDER BY t.rowid`)
    .all(mark, t - TRADE_DAYS * 86_400) as Row[];
  const dirty = db.prepare(`${cols} WHERE t.dirty_at > ? AND t.rowid <= ? AND t.ts > ? AND k.unpriced_at IS NULL`)
    .all(dirtySince, mark, t - TRADE_DAYS * 86_400) as Row[];
  const trades = [...rows, ...dirty].flatMap(r => {
    const cat = categoryAt(labels.get(r.wallet_id), r.ts);
    return cat ? [{ id: tradeId(key, r.tx_hash, r.wallet_id, r.token), token: r.token, wallet_id: r.wallet_id,
      category: cat, side: r.side, token_qty: sig(Number(r.token_amount) / 10 ** r.dec), usd: sigN(r.usd), ts: coarseTs(r.ts),
      below_floor: !!r.below_floor, via: r.via }] : [];
  });
  await upsert('trades', trades, 'id');
  if (rows.length) {
    db.prepare(`INSERT INTO cursor (name, block) VALUES ('pub_trades_v2', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`)
      .run(rows[rows.length - 1]!.rid);
  }
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('pub_trades_dirty', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`).run(t);
  await check(client().from('trades').delete().lt('ts', iso(t - TRADE_DAYS * 86_400)), 'trades prune');

  const swept = (db.prepare(`SELECT block FROM cursor WHERE name = 'pub_unpriced_sweep'`).get() as { block: number } | undefined)?.block ?? 0;
  const gone = (db.prepare(`SELECT address FROM tokens WHERE unpriced_at > ?`).all(swept) as { address: string }[]).map(r => r.address);
  for (let i = 0; i < gone.length; i += 100) {
    const part = gone.slice(i, i + 100);
    await check(client().from('trades').delete().in('token', part), 'trades unpriced');
    await check(client().from('holder_counts').delete().in('token', part), 'holder_counts unpriced');
    await check(client().from('tokens').delete().in('address', part), 'tokens unpriced');
  }
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('pub_unpriced_sweep', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`).run(t);

  const board = db.prepare(`SELECT * FROM calc_board`).all().map(r => {
    const b = r as { who: string; holders_cat: string | null };
    const who = (JSON.parse(b.who) as { usd: number | null }[]).map(w => ({ ...w, usd: sigN(w.usd) }));
    return { ...b, who, holders_cat: b.holders_cat ? JSON.parse(b.holders_cat) : null };
  });
  await check(client().rpc('publish_round', {
    p_board: board,
    p_rotations: db.prepare(`SELECT * FROM calc_rotations`).all(),
    p_positions: (db.prepare(`SELECT * FROM calc_positions`).all() as { wallet_id: number; token: string; qty: number; costed_qty: number; cost_usd: number;
      costless_qty: number; realized_usd: number; value_usd: number | null }[]).filter(p => current.has(p.wallet_id) && (p.value_usd ?? 0) >= MIN_TRADE_USD).map(p => ({
      wallet_id: p.wallet_id, token: p.token, qty: sigN(p.qty), costed_qty: sigN(p.costed_qty), cost_usd: sigN(p.cost_usd),
      costless_qty: sigN(p.costless_qty), realized_usd: sigN(p.realized_usd), value_usd: sigN(p.value_usd),
    })),
  }), 'publish_round');

  const series = db.prepare(`SELECT ts, category, usd FROM calc_usdc_series WHERE ts = (SELECT max(ts) FROM calc_usdc_series)`)
    .all() as { ts: number; category: string; usd: number }[];
  await upsert('usdc_series', series.map(s => ({ ...s, ts: iso(s.ts) })), 'ts,category');

  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'holder_counts'`).get()) {
    const hc = db.prepare(`SELECT token, ts, holders FROM holder_counts WHERE ts = (SELECT max(ts) FROM holder_counts)`)
      .all() as { token: string; ts: number; holders: number }[];
    await upsert('holder_counts', hc.map(h => ({ ...h, ts: iso(h.ts) })), 'token,ts');
  }

  await publishWhaleTokens(db);
  await check(client().from('worker_status').upsert({ id: 1, last_block: lastBlock, last_round_at: iso(t) }), 'worker_status');
  return { trades: trades.length, board: board.length };
}

export function publicError(e: unknown): string {
  return String(e).split('\n')[0]!
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/0x[0-9a-fA-F]{40,}/g, '0x…')
    .slice(0, 200);
}

export async function reportError(e: unknown): Promise<void> {
  try {
    const cur = await client().from('worker_status').select('error_count').eq('id', 1).maybeSingle();
    await client().from('worker_status').upsert({ id: 1, error_count: ((cur.data?.error_count as number) ?? 0) + 1,
      last_error: publicError(e) });
  } catch {  }
}
