import { num } from '../config.js';
import { MAINNET_START_BLOCK, TRANSFER_TOPIC, USDC, USDC_MIRROR } from '../chain.js';
import { now, type DB } from '../db.js';
import { blockAtTime, blockNumber, getLogs, isRangeError, rpcBatch, type RawLog } from '../rpc.js';
import { codeKind } from '../scan/codeKind.js';
import { loadWallets, scanRange } from '../scan/scanner.js';
import { addWallet, hasHistory } from '../wallets.js';

export const CAND_MIN_MCAP_USD = num('CAND_MIN_MCAP_USD');
export const CAND_MIN_LIQ_USD = num('CAND_MIN_LIQ_USD');
export const CAND_MAX_LIQ_RATIO = num('CAND_MAX_LIQ_RATIO');
export const CAND_MIN_USD = num('CAND_MIN_USD');
const STEP = 5_000;
const CALLS_PER_ROUND = 30;
const CHECKS_PER_ROUND = 400;
const CODE_BATCH = 20;
const WALLET_STEP = 10_000;
const HISTORY_DAYS = 30;
const MAX_ADDR = 20;

export const DERIVATIVES = new Set([
  USDC, USDC_MIRROR,
  '0x171a4217b86a807a64eb94757db6849fb4bdbaa0',
  '0x128cc466b61f542da60c70e3aa11c10e19b84edb',
  '0x178b01f61cbea1d2a5581fe1621be607835ec349',
  '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1',
  '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b',
]);

const EXCLUDE_ADDR = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cand_tokens (
  token      TEXT PRIMARY KEY,
  scanned_to INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cand_seen (
  address TEXT PRIMARY KEY,
  usd     REAL NOT NULL,
  n       INTEGER NOT NULL,
  status  TEXT
);`;

export interface MarketRow { token: string; symbol: string | null; mcap: number | null; liq: number | null }

export function pickSourceTokens(rows: MarketRow[], blacklisted: (t: string) => boolean = () => false): string[] {
  const top = new Map<string, number>();
  for (const r of rows) {
    const s = (r.symbol ?? '').toUpperCase();
    if (s) top.set(s, Math.max(top.get(s) ?? 0, r.mcap ?? 0));
  }
  return rows.filter(r => {
    const mcap = r.mcap ?? 0, liq = r.liq ?? 0;
    if (mcap < CAND_MIN_MCAP_USD || liq < CAND_MIN_LIQ_USD) return false;
    if (liq > mcap * CAND_MAX_LIQ_RATIO) return false;
    if (DERIVATIVES.has(r.token) || blacklisted(r.token)) return false;
    const s = (r.symbol ?? '').toUpperCase();
    return !s || top.get(s) === mcap;
  }).map(r => r.token);
}

export function sourceTokens(db: DB): string[] {
  const rows = db.prepare(`SELECT p.token, k.symbol, p.mcap_usd AS mcap, p.liquidity_usd AS liq
    FROM prices p LEFT JOIN tokens k ON k.address = p.token`).all() as MarketRow[];
  const bl = db.prepare(`SELECT 1 FROM token_blacklist WHERE address = ?`);
  return pickSourceTokens(rows, t => !!bl.get(t));
}

async function fetchRange(tokens: string[], from: number, to: number): Promise<RawLog[]> {
  try {
    return await getLogs({ fromBlock: from, toBlock: to, address: tokens, topics: [TRANSFER_TOPIC] });
  } catch (e) {
    if (!isRangeError(e) || from >= to) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...await fetchRange(tokens, from, mid), ...await fetchRange(tokens, mid + 1, to)];
  }
}

export async function candidateRound(db: DB, maxCalls = CALLS_PER_ROUND): Promise<{ tokens: number; calls: number; added: number; behind: number; pending: number }> {
  db.exec(SCHEMA);
  const tokens = sourceTokens(db);
  const insTok = db.prepare(`INSERT OR IGNORE INTO cand_tokens (token, scanned_to) VALUES (?, ?)`);
  for (const t of tokens) insTok.run(t, MAINNET_START_BLOCK - 1);

  const head = await blockNumber();
  const meta = new Map((db.prepare(`SELECT k.address, k.decimals, p.price_usd FROM tokens k JOIN prices p ON p.token = k.address`)
    .all() as { address: string; decimals: number | null; price_usd: number | null }[]).map(r => [r.address, r]));
  const cursor = db.prepare(`SELECT scanned_to FROM cand_tokens WHERE token = ?`);
  const setCursor = db.prepare(`UPDATE cand_tokens SET scanned_to = ? WHERE token = ?`);
  const upSeen = db.prepare(`INSERT INTO cand_seen (address, usd, n) VALUES (?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET usd = usd + excluded.usd, n = n + excluded.n`);

  const byCursor = new Map<number, string[]>();
  for (const t of tokens) {
    const c = (cursor.get(t) as { scanned_to: number }).scanned_to;
    (byCursor.get(c) ?? byCursor.set(c, []).get(c)!).push(t);
  }
  const groups: [number, string[]][] = [];
  for (const [c, ts] of [...byCursor].sort((a, b) => a[0] - b[0]))
    for (let i = 0; i < ts.length; i += MAX_ADDR) groups.push([c, ts.slice(i, i + MAX_ADDR)]);
  let calls = 0;
  for (const [start, group] of groups) {
    let from = start + 1;
    while (from <= head && calls < maxCalls) {
      const to = Math.min(head, from + STEP - 1);
      const logs = await fetchRange(group, from, to);
      calls++;
      const acc = new Map<string, { usd: number; n: number }>();
      for (const l of logs) {
        const m = meta.get(l.address.toLowerCase());
        const usd = m?.price_usd != null ? (Number(BigInt(l.data === '0x' ? 0 : l.data)) / 10 ** (m.decimals ?? 18)) * m.price_usd : 0;
        for (const topic of [l.topics[1], l.topics[2]]) {
          if (!topic) continue;
          const a = '0x' + topic.slice(26).toLowerCase();
          const v = acc.get(a) ?? acc.set(a, { usd: 0, n: 0 }).get(a)!;
          v.usd += usd; v.n++;
        }
      }
      db.transaction(() => {
        for (const [a, v] of acc) upSeen.run(a, v.usd, v.n);
        for (const t of group) setCursor.run(to, t);
      })();
      from = to + 1;
    }
  }

  const added = await promote(db);
  const behind = tokens.filter(t => (cursor.get(t) as { scanned_to: number }).scanned_to < head - STEP).length;
  return { tokens: tokens.length, calls, added, behind, pending: pendingCount(db) };
}

const pendingCount = (db: DB) => (db.prepare(`SELECT count(*) AS n FROM cand_seen WHERE status IS NULL AND usd >= ?`)
  .get(CAND_MIN_USD) as { n: number }).n;

async function promote(db: DB): Promise<number> {
  const rows = (db.prepare(`SELECT address FROM cand_seen WHERE status IS NULL AND usd >= ? ORDER BY usd DESC LIMIT ?`).all(CAND_MIN_USD, CHECKS_PER_ROUND) as { address: string }[])
    .map(r => r.address);
  const setStatus = db.prepare(`UPDATE cand_seen SET status = ? WHERE address = ?`);
  const known = db.prepare(`SELECT 1 FROM wallets WHERE address = ?`);
  const black = db.prepare(`SELECT 1 FROM wallet_blacklist WHERE address = ?`);
  let fresh = 0;
  const unknown: string[] = [];
  for (const a of rows) {
    if (EXCLUDE_ADDR.has(a)) { setStatus.run('contract', a); continue; }
    if (black.get(a)) { setStatus.run('blacklist', a); continue; }
    if (known.get(a)) { setStatus.run('known', a); continue; }
    unknown.push(a);
  }
  const codes = new Map<string, string>();
  for (let i = 0; i < unknown.length; i += CODE_BATCH) {
    const part = unknown.slice(i, i + CODE_BATCH);
    const res = await rpcBatch<string>('eth_getCode', part.map(a => [a, 'latest']));
    part.forEach((a, j) => { if (res[j] !== undefined) codes.set(a, res[j]!); });
  }
  for (const [a, code] of codes) {
    const kind = codeKind(code);
    if (kind === 'contract') { setStatus.run('contract', a); continue; }
    const id = addWallet(db, a, 'candidate', null, MAINNET_START_BLOCK, { source: 'cand-scan', noBackfill: true });
    if (id == null) { setStatus.run('blacklist', a); continue; }
    db.prepare(`UPDATE wallets SET code_kind = ?, code_checked_at = ? WHERE id = ?`).run(kind, now(), id);
    setStatus.run('added', a);
    fresh++;
  }
  return fresh;
}

interface Job { id: number; name: string; wallet_ids: string; to_block: number; next_block: number }

export async function walletScanStep(db: DB, caughtUp: boolean, maxSteps = 20):
  Promise<{ job: string; wallets: number; pct: number; done: boolean } | null> {
  let job = db.prepare(`SELECT id, name, wallet_ids, to_block, next_block FROM backfill_jobs
    WHERE name LIKE 'cand-%' AND status != 'done' ORDER BY id LIMIT 1`).get() as Job | undefined;
  if (!job) {
    if (!caughtUp) return null;
    db.prepare(`DELETE FROM backfill_jobs WHERE name LIKE 'admin-cand-%' AND status = 'pending' AND next_block = from_block`).run();
    const live = db.prepare(`SELECT block FROM cursor WHERE name = 'live'`).get() as { block: number } | undefined;
    const ids = (db.prepare(`SELECT DISTINCT l.wallet_id AS id FROM wallet_labels l JOIN wallets w ON w.id = l.wallet_id
      WHERE l.category = 'candidate' AND l.valid_to IS NULL AND w.source = 'cand-scan'`).all() as { id: number }[])
      .map(r => r.id).filter(id => !hasHistory(db, id));
    if (!live || !ids.length) return null;
    const from = await blockAtTime(now() - HISTORY_DAYS * 86_400);
    const ins = db.prepare(`INSERT INTO backfill_jobs (name, wallet_ids, from_block, to_block, next_block, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const mainFrom = Math.max(from, MAINNET_START_BLOCK);
    ins.run(`cand-${now()}-mainnet`, JSON.stringify(ids), mainFrom, live.block, mainFrom, now(), now());
    if (from < MAINNET_START_BLOCK)
      ins.run(`cand-${now()}-early`, JSON.stringify(ids), from, MAINNET_START_BLOCK - 1, from, now(), now());
    return walletScanStep(db, caughtUp, maxSteps);
  }
  const ids = JSON.parse(job.wallet_ids) as number[];
  const wallets = loadWallets(db, ids);
  const first = (db.prepare(`SELECT from_block FROM backfill_jobs WHERE id = ?`).get(job.id) as { from_block: number }).from_block;
  let next = job.next_block;
  for (let i = 0; i < maxSteps && next <= job.to_block; i++) {
    const to = Math.min(job.to_block, next + WALLET_STEP - 1);
    await scanRange(db, next, to, wallets);
    next = to + 1;
    db.prepare(`UPDATE backfill_jobs SET next_block = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(next, next > job.to_block ? 'done' : 'running', now(), job.id);
  }
  const pct = Math.round(((next - first) / Math.max(1, job.to_block + 1 - first)) * 1000) / 10;
  return { job: job.name, wallets: ids.length, pct, done: next > job.to_block };
}
