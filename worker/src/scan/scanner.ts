import { ADDRESS_CHUNK, TRANSFER_TOPIC, USDC, USDC_MIRROR } from '../chain.js';
import { getLogs, isRangeError, rpcBatch, RpcError, type RawLog } from '../rpc.js';
import { now, type DB } from '../db.js';
import { padTopic, toLeg } from './logs.js';
import { relayCounterparty, resolveTx, usdcTrade, type Leg, type TradeRow, type TransferRow } from './resolve.js';

export type WalletMap = Map<string, number>;

export function loadWallets(db: DB, ids?: number[]): WalletMap {
  const rows = db.prepare(`SELECT id, address FROM wallets`).all() as { id: number; address: string }[];
  const keep = ids ? new Set(ids) : null;
  return new Map(rows.filter(r => !keep || keep.has(r.id)).map(r => [r.address, r.id]));
}

async function fetchRange(from: number, to: number, topics: (string | string[] | null)[]): Promise<RawLog[]> {
  try {
    return await getLogs({ fromBlock: from, toBlock: to, topics });
  } catch (e) {
    if (!isRangeError(e) || from === to) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...await fetchRange(from, mid, topics), ...await fetchRange(mid + 1, to, topics)];
  }
}

export async function scanRange(db: DB, from: number, to: number, wallets: WalletMap): Promise<{ legs: number; txs: number }> {
  const addrs = [...wallets.keys()];
  const logs = new Map<string, RawLog>();
  for (let i = 0; i < addrs.length; i += ADDRESS_CHUNK) {
    const chunk = addrs.slice(i, i + ADDRESS_CHUNK).map(padTopic);
    for (const topics of [[TRANSFER_TOPIC, chunk], [TRANSFER_TOPIC, null, chunk]]) {
      for (const l of await fetchRange(from, to, topics)) logs.set(`${l.transactionHash}:${l.logIndex}`, l);
    }
  }

  const insLeg = db.prepare(
    `INSERT INTO legs (tx_hash, log_index, block, ts, token, "from", "to", amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  const txs = new Set<string>();
  let n = 0;
  db.transaction(() => {
    for (const l of logs.values()) {
      const leg = toLeg(l);
      if (!leg || leg.token === USDC_MIRROR) continue;
      if (!l.blockTimestamp) throw new Error(`blockTimestamp missing: ${l.transactionHash}`);
      insLeg.run(l.transactionHash, Number(l.logIndex), Number(l.blockNumber), Number(l.blockTimestamp),
        leg.token, leg.from, leg.to, leg.amount.toString());
      txs.add(l.transactionHash);
      n++;
    }
    for (const tx of txs) resolveStoredTx(db, tx, wallets);
  })();
  return { legs: n, txs: txs.size };
}

export function resolveStoredTx(db: DB, tx: string, wallets: WalletMap): void {
  const rows = db.prepare(`SELECT block, ts, token, "from", "to", amount FROM legs WHERE tx_hash = ?`)
    .all(tx) as { block: number; ts: number; token: string; from: string; to: string; amount: string }[];
  if (!rows.length) return;
  const { block, ts } = rows[0]!;
  const legs: Leg[] = rows.map(r => ({ token: r.token, from: r.from, to: r.to, amount: BigInt(r.amount) }));
  const { trades, transfers } = resolveTx(legs, a => wallets.has(a));

  const relays = db.prepare(`SELECT wallet_id, token, usdc FROM relay_checks WHERE tx_hash = ? AND party IS NOT NULL`)
    .all(tx) as { wallet_id: number; token: string; usdc: string }[];
  const relayed: TradeRow[] = [];
  const keptTransfers: TransferRow[] = [];
  for (const t of transfers) {
    const r = relays.find(x => x.wallet_id === wallets.get(t.wallet) && x.token === t.token);
    if (r) relayed.push(usdcTrade(t.wallet, t.token, t.direction === 'in' ? 'buy' : 'sell', t.amount, BigInt(r.usdc)));
    else keptTransfers.push(t);
  }

  const ids = [...new Set([...trades, ...transfers].map(r => wallets.get(r.wallet)!))];
  const delT = db.prepare(`DELETE FROM trades WHERE tx_hash = ? AND wallet_id = ?`);
  const delX = db.prepare(`DELETE FROM transfers WHERE tx_hash = ? AND wallet_id = ?`);
  for (const id of ids) { delT.run(tx, id); delX.run(tx, id); }

  const insT = db.prepare(
    `INSERT INTO trades (tx_hash, wallet_id, token, block, ts, side, token_amount, usdc_amount, usd, counter, below_floor, via)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const writeTrade = (t: TradeRow, via: string) => insT.run(tx, wallets.get(t.wallet)!, t.token, block, ts, t.side,
    t.tokenAmount.toString(), t.usdcAmount?.toString() ?? null, t.usd, t.counter, t.belowFloor ? 1 : 0, via);
  for (const t of trades) writeTrade(t, 'direct');
  for (const t of relayed) writeTrade(t, 'relay');

  const insX = db.prepare(
    `INSERT INTO transfers (tx_hash, wallet_id, token, block, ts, direction, amount, counterparty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const t of keptTransfers) {
    insX.run(tx, wallets.get(t.wallet)!, t.token, block, ts, t.direction, t.amount.toString(), t.counterparty);
  }
}

const SWAP_TOPICS = new Set([
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',
]);
const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';

const RECEIPT_BATCH = 30;
const RECEIPT_TRIES = 3;

type Receipt = { logs: RawLog[] } | null | undefined;

async function fetchReceipts(txs: string[]): Promise<Map<string, Receipt>> {
  const out = new Map<string, Receipt>();
  let todo = txs;
  for (let attempt = 0; attempt < RECEIPT_TRIES && todo.length; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000));
    for (let i = 0; i < todo.length; i += RECEIPT_BATCH) {
      const part = todo.slice(i, i + RECEIPT_BATCH);
      let res: Receipt[] = [];
      try {
        res = await rpcBatch<{ logs: RawLog[] } | null>('eth_getTransactionReceipt', part.map(tx => [tx]));
      } catch (e) {
        await new Promise(r => setTimeout(r, e instanceof RpcError && e.code === 429 ? 15_000 : 3000));
      }
      part.forEach((tx, j) => { if (res[j]) out.set(tx, res[j]); });
    }
    todo = todo.filter(tx => !out.get(tx));
  }
  return out;
}

export async function enrichRelays(db: DB, limit = 500, sinceTs = 0): Promise<{ checked: number; relayed: number; txs: number; ms: { select: number; fetch: number; write: number } }> {
  const t0 = Date.now();
  const pending = db.prepare(
    `SELECT x.tx_hash, x.wallet_id, x.token, x.direction, x.amount, w.address
     FROM transfers x JOIN wallets w ON w.id = x.wallet_id
     LEFT JOIN relay_checks r ON r.tx_hash = x.tx_hash AND r.wallet_id = x.wallet_id AND r.token = x.token
     WHERE x.token != ? AND r.tx_hash IS NULL AND x.ts > ?
     ORDER BY x.block LIMIT ?`,
  ).all(USDC, sinceTs, limit) as Pending[];

  const byTx = new Map<string, Pending[]>();
  for (const p of pending) (byTx.get(p.tx_hash) ?? byTx.set(p.tx_hash, []).get(p.tx_hash)!).push(p);

  const entries = [...byTx];
  const t1 = Date.now();
  const receipts = await fetchReceipts(entries.map(e => e[0]));
  const t2 = Date.now();
  const relayed = applyReceipts(db, entries, receipts);
  return { checked: pending.length, relayed, txs: entries.length, ms: { select: t1 - t0, fetch: t2 - t1, write: Date.now() - t2 } };
}

type Pending = { tx_hash: string; wallet_id: number; token: string; direction: string; amount: string; address: string };

function applyReceipts(db: DB, entries: [string, Pending[]][], receipts: Map<string, { logs: RawLog[] } | null | undefined>): number {
  const ins = db.prepare(
    `INSERT OR REPLACE INTO relay_checks (tx_hash, wallet_id, token, party, usdc, checked_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let relayed = 0;
  for (const [tx, items] of entries) {
    const rc = receipts.get(tx);
    if (!rc) continue;
    const swaps = rc.logs.filter(l => SWAP_TOPICS.has(l.topics[0] ?? ''));
    const legs = rc.logs.map(toLeg).filter((l): l is Leg => l !== null);
    const exclude = new Set([V4_POOL_MANAGER, ...swaps.map(l => l.address.toLowerCase())]);
    const found = items.map(it => {
      const delta = it.direction === 'in' ? BigInt(it.amount) : -BigInt(it.amount);
      return { it, r: swaps.length ? relayCounterparty(legs, it.address, delta, exclude) : null };
    });
    db.transaction(() => {
      for (const { it, r } of found) {
        ins.run(tx, it.wallet_id, it.token, r?.party ?? null, r?.usdc.toString() ?? null, now());
        if (r) relayed++;
      }
      if (found.some(f => f.r)) {
        resolveStoredTx(db, tx, loadWallets(db, [...new Set(items.map(i => i.wallet_id))]));
      }
    })();
  }
  return relayed;
}

export function relayRouters(db: DB): string[] {
  const rows = db.prepare(
    `SELECT CASE WHEN l."to" = w.address THEN l."from" ELSE l."to" END AS cp, count(*) AS n, sum(r.party IS NOT NULL) AS rel
     FROM relay_checks r JOIN wallets w ON w.id = r.wallet_id
     JOIN legs l ON l.tx_hash = r.tx_hash AND l.token = r.token AND (l."to" = w.address OR l."from" = w.address)
     GROUP BY cp HAVING rel >= 5 AND rel >= 0.2 * n`,
  ).all() as { cp: string }[];
  return rows.map(r => r.cp);
}

const RELAY_SKIP_FROM = 1789516800;
const RELAY_SKIP_TO = 1789603200;

export async function enrichRelayHistory(db: DB, routers: string[], limit = 600): Promise<{ checked: number; relayed: number; left: number }> {
  if (!routers.length) return { checked: 0, relayed: 0, left: 0 };
  const pending = db.prepare(
    `SELECT x.tx_hash, x.wallet_id, x.token, x.direction, x.amount, w.address
     FROM transfers x JOIN wallets w ON w.id = x.wallet_id
     LEFT JOIN relay_checks r ON r.tx_hash = x.tx_hash AND r.wallet_id = x.wallet_id AND r.token = x.token
     WHERE x.counterparty IN (SELECT value FROM json_each(?)) AND x.token != ? AND r.tx_hash IS NULL
       AND NOT (x.ts >= ? AND x.ts < ?)
     ORDER BY x.block DESC LIMIT ?`,
  ).all(JSON.stringify(routers), USDC, RELAY_SKIP_FROM, RELAY_SKIP_TO, limit) as Pending[];
  const byTx = new Map<string, Pending[]>();
  for (const p of pending) (byTx.get(p.tx_hash) ?? byTx.set(p.tx_hash, []).get(p.tx_hash)!).push(p);
  const entries = [...byTx];
  const receipts = await fetchReceipts(entries.map(e => e[0]));
  const relayed = applyReceipts(db, entries, receipts);
  const got = entries.filter(([tx]) => receipts.get(tx)).length;
  return { checked: got, relayed, left: pending.length === limit ? 1 : 0 };
}
