import { num } from '../config.js';
import { ENTRY_POINTS, MAINNET_START_BLOCK } from '../chain.js';
import { now, type DB } from '../db.js';
import { rpc } from '../rpc.js';
import { codeKind } from '../scan/codeKind.js';
import { addBackfillJob, addWallet, hasHistory } from '../wallets.js';
import { fetchMarkets } from './dexscreener.js';
import { displaySymbol } from './symbol.js';

export const MIN_SUPPLY_PCT = num('WHALE_MIN_SUPPLY_PCT');
export const MIN_HOLDING_USD = num('WHALE_MIN_HOLDING_USD');
const RESCAN_SEC = 6 * 3600;
const DROP_SEC = 30 * 86_400;
const PAGE = 100;
const MAX_PAGES = 25;
const API = 'https://arcexplorer.org/api/v1';

const EXCLUDE = new Set([
  '0x000000000000000000000000000000000000dead',
  '0x0000000000000000000000000000000000000000',
  ...ENTRY_POINTS,
]);

export interface Holder { address: string; balance: bigint }
export interface Whale { address: string; rank: number; pct: number; usd: number | null }

export function pctOfSupply(raw: bigint, supply: bigint): number {
  return supply > 0n ? Number((raw * 1_000_000n) / supply) / 10_000 : 0;
}

export function qualifies(raw: bigint, supply: bigint, decimals: number, price: number | null): boolean {
  if (pctOfSupply(raw, supply) >= MIN_SUPPLY_PCT) return true;
  return price != null && (Number(raw) / 10 ** decimals) * price >= MIN_HOLDING_USD;
}

export function pickWhales(holders: Holder[], supply: bigint, decimals: number, price: number | null,
  exclude: (a: string) => boolean): Whale[] {
  const out: Whale[] = [];
  for (const h of holders) {
    if (!qualifies(h.balance, supply, decimals, price)) break;
    if (exclude(h.address)) continue;
    out.push({ address: h.address, rank: out.length + 1, pct: pctOfSupply(h.balance, supply),
      usd: price != null ? (Number(h.balance) / 10 ** decimals) * price : null });
  }
  return out;
}

let explorerDown = false;

async function getJson<T>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      if (i >= 2) { explorerDown = true; throw e; }
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (i >= 2) {
      if (res.status >= 500) explorerDown = true;
      throw new Error(`arcexplorer HTTP ${res.status} ${path}`);
    }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}

async function fetchHolders(token: string, supply: bigint, decimals: number, price: number | null): Promise<Holder[]> {
  const out: Holder[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getJson<{ items?: { address: string; balance: string }[]; nextOffset?: number | null }>(
      `/tokens/${token}/holders?limit=${PAGE}&offset=${offset}`);
    for (const r of body.items ?? []) {
      const h = { address: String(r.address).toLowerCase(), balance: BigInt(r.balance ?? '0') };
      out.push(h);
      if (!qualifies(h.balance, supply, decimals, price)) return out;
    }
    if (body.nextOffset == null) break;
    offset = body.nextOffset;
  }
  return out;
}

async function isContract(db: DB, address: string): Promise<boolean> {
  const w = db.prepare(`SELECT code_kind FROM wallets WHERE address = ?`).get(address) as { code_kind: string | null } | undefined;
  if (w?.code_kind) return w.code_kind === 'contract';
  return codeKind(await rpc<string>('eth_getCode', [address, 'latest'])) === 'contract';
}

function whaleName(db: DB, symbol: string, rank: number): string {
  const taken = db.prepare(`SELECT 1 FROM wallet_labels WHERE label = ?`);
  let n = rank;
  while (taken.get(`WHALE-${symbol}-${n}`)) n++;
  return `WHALE-${symbol}-${n}`;
}

export interface ScanResult { token: string; symbol: string; whales: number; added: number }

export async function scanWhaleToken(db: DB, token: string): Promise<ScanResult> {
  const info = await getJson<{ symbol?: string; name?: string; decimals?: number | string; totalSupply?: string }>(`/tokens/${token}`);
  const supply = BigInt(info.totalSupply ?? '0');
  if (supply <= 0n) throw new Error('totalSupply unreadable');
  const decimals = Number(info.decimals ?? 18);
  const symbol = displaySymbol(token, info.symbol, info.name);
  let price = (db.prepare(`SELECT price_usd FROM prices WHERE token = ?`).get(token) as { price_usd: number | null } | undefined)?.price_usd ?? null;
  if (price == null) price = (await fetchMarkets([token])).get(token)?.priceUsd ?? null;

  const holders = await fetchHolders(token, supply, decimals, price);
  const blacklisted = db.prepare(`SELECT 1 FROM wallet_blacklist WHERE address = ?
    UNION ALL SELECT 1 FROM wallets WHERE address = ? AND bot_at IS NOT NULL`);
  const drop = new Set<string>();
  for (const h of holders) {
    if (EXCLUDE.has(h.address) || h.address === token || blacklisted.get(h.address, h.address)) drop.add(h.address);
    else if (qualifies(h.balance, supply, decimals, price) && await isContract(db, h.address)) drop.add(h.address);
  }
  const whales = pickWhales(holders, supply, decimals, price, a => drop.has(a));

  const t = now();
  const fresh: number[] = [];
  db.transaction(() => {
    const scan = db.prepare(`INSERT INTO whale_scans (wallet_id, token, rank, pct_of_supply, value_usd, first_seen_at, last_seen_at)
      VALUES (@id, @token, @rank, @pct, @usd, @t, @t) ON CONFLICT(wallet_id, token) DO UPDATE SET
      rank = excluded.rank, pct_of_supply = excluded.pct_of_supply, value_usd = excluded.value_usd, last_seen_at = excluded.last_seen_at`);
    for (const w of whales) {
      const known = db.prepare(`SELECT id FROM wallets WHERE address = ?`).get(w.address) as { id: number } | undefined;
      const hasWhaleLabel = known && db.prepare(`SELECT 1 FROM wallet_labels WHERE wallet_id = ? AND category = 'whale' AND valid_to IS NULL`).get(known.id);
      const id = addWallet(db, w.address, 'whale', hasWhaleLabel ? null : whaleName(db, symbol, w.rank), MAINNET_START_BLOCK,
        { source: 'whale-scan', meta: { token }, noBackfill: true });
      if (id == null) continue;
      if (!hasHistory(db, id)) fresh.push(id);
      scan.run({ id, token, rank: w.rank, pct: w.pct, usd: w.usd, t });
    }
    addBackfillJob(db, `admin-whale-${symbol}-${t}`, fresh, MAINNET_START_BLOCK);
    db.prepare(`UPDATE whale_tokens SET symbol = ?, last_scanned_at = ?, next_scan_at = ?, scan_status = 'ready',
      scan_error = NULL, whale_count = ? WHERE token = ?`).run(symbol, t, t + RESCAN_SEC, whales.length, token);
  })();
  return { token, symbol, whales: whales.length, added: fresh.length };
}

export function dropStaleWhales(db: DB, at = now()): number {
  return db.prepare(
    `UPDATE wallet_labels SET valid_to = ? WHERE category = 'whale' AND valid_to IS NULL
       AND wallet_id IN (SELECT wallet_id FROM whale_scans GROUP BY wallet_id HAVING max(last_seen_at) < ?)`,
  ).run(at, at - DROP_SEC).changes;
}

const EXPLORER_DOWN_RETRY_SEC = 3600;

export async function whaleRound(db: DB): Promise<{ scanned: ScanResult[]; errors: number; dropped: number }> {
  const due = (db.prepare(`SELECT token FROM whale_tokens WHERE next_scan_at IS NULL OR next_scan_at <= ?`)
    .all(now()) as { token: string }[]).map(r => r.token);
  const scanned: ScanResult[] = [];
  let errors = 0;
  for (const [i, token] of due.entries()) {
    if (explorerDown) {
      db.prepare(`UPDATE whale_tokens SET next_scan_at = ? WHERE token IN (SELECT value FROM json_each(?))`)
        .run(now() + EXPLORER_DOWN_RETRY_SEC, JSON.stringify(due.slice(i)));
      break;
    }
    try {
      scanned.push(await scanWhaleToken(db, token));
    } catch (e) {
      errors++;
      db.prepare(`UPDATE whale_tokens SET scan_status = 'error', scan_error = ?, next_scan_at = ? WHERE token = ?`)
        .run(String((e as Error)?.message ?? e), now() + (explorerDown ? EXPLORER_DOWN_RETRY_SEC : RESCAN_SEC), token);
    }
  }
  explorerDown = false;
  return { scanned, errors, dropped: dropStaleWhales(db) };
}
