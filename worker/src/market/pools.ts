import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { now, type DB } from '../db.js';
import { blockNumber, getLogs, isRangeError, rpc, type RawLog } from '../rpc.js';
import {
  MULTICALL3, TOPIC_V3_POOL_CREATED, TOPIC_V4_INITIALIZE, USD_QUOTES, V3_FACTORY, V4_POOL_MANAGER,
  liquidityFromWord, liquidityUsd, parsePoolLog, priceFromSqrt, sqrtPriceFromWord, v4LiquiditySlot,
  v4QuoteReserveRaw, v4StateSlot, type PoolRow,
} from './poolRules.js';

const STEP = 10_000;
const V4_SLOTS_PER_CALL = Number(process.env.V4_SLOTS_PER_CALL ?? 2000);
const V3_POOLS_PER_CALL = 150;

const abi = parseAbi([
  'function extsload(bytes32[] slots) view returns (bytes32[])',
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function balanceOf(address) view returns (uint256)',
]);

async function logsIn(from: number, to: number): Promise<RawLog[]> {
  try {
    return await getLogs({
      fromBlock: from, toBlock: to,
      address: [V4_POOL_MANAGER, V3_FACTORY],
      topics: [[TOPIC_V4_INITIALIZE, TOPIC_V3_POOL_CREATED]],
    });
  } catch (e) {
    if (!isRangeError(e) || from === to) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...await logsIn(from, mid), ...await logsIn(mid + 1, to)];
  }
}

export function insertPool(db: DB, p: PoolRow): number {
  return db.prepare(
    `INSERT OR IGNORE INTO pools (id, kind, token, quote, token_is0, fee, hooks, block, ts)
     VALUES (@id, @kind, @token, @quote, @token_is0, @fee, @hooks, @block, @ts)`,
  ).run(p).changes;
}

export function insertPools(db: DB, logs: RawLog[]): number {
  let n = 0;
  db.transaction(() => {
    for (const l of logs) {
      const p = parsePoolLog(l);
      if (p) n += insertPool(db, p);
    }
  })();
  return n;
}

const setCursor = (db: DB, block: number) =>
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('pools', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`).run(block);

export async function syncPools(db: DB): Promise<number> {
  const cur = db.prepare(`SELECT block FROM cursor WHERE name = 'pools'`).get() as { block: number } | undefined;
  if (!cur) return 0;
  const head = await blockNumber();
  let added = 0;
  for (let from = cur.block + 1; from <= head; from += STEP) {
    const to = Math.min(head, from + STEP - 1);
    added += insertPools(db, await logsIn(from, to));
    setCursor(db, to);
  }
  return added;
}

export function seedPools(db: DB, logs: RawLog[], scannedTo: number): number {
  const n = insertPools(db, logs);
  setCursor(db, scannedTo);
  return n;
}

async function call(to: string, data: `0x${string}`): Promise<`0x${string}`> {
  return rpc<`0x${string}`>('eth_call', [{ to, data }, 'latest']);
}

export interface PoolRead { id: string; token: string; priceUsd: number; liquidityUsd: number }

export async function readPools(pools: PoolRow[], decimals: Map<string, number | null>): Promise<PoolRead[]> {
  const out: PoolRead[] = [];
  const known = pools.filter(p => decimals.get(p.token) != null);

  const v4 = known.filter(p => p.kind === 'v4');
  const per = Math.floor(V4_SLOTS_PER_CALL / 2);
  for (let i = 0; i < v4.length; i += per) {
    const part = v4.slice(i, i + per);
    const slots = part.flatMap(p => { const s = v4StateSlot(p.id); return [s, v4LiquiditySlot(s)]; });
    const data = await call(V4_POOL_MANAGER, encodeFunctionData({ abi, functionName: 'extsload', args: [slots] }));
    const words = decodeFunctionResult({ abi, functionName: 'extsload', data }) as readonly `0x${string}`[];
    part.forEach((p, j) => {
      const sq = sqrtPriceFromWord(words[2 * j]!);
      const L = liquidityFromWord(words[2 * j + 1]!);
      const qDec = USD_QUOTES[p.quote]!;
      const price = priceFromSqrt(sq, p.token_is0 === 1, decimals.get(p.token)!, qDec);
      if (price == null) return;
      out.push({ id: p.id, token: p.token, priceUsd: price, liquidityUsd: liquidityUsd(v4QuoteReserveRaw(L, sq, p.token_is0 === 1), qDec, 1) ?? 0 });
    });
  }

  const v3 = known.filter(p => p.kind === 'v3');
  for (let i = 0; i < v3.length; i += V3_POOLS_PER_CALL) {
    const part = v3.slice(i, i + V3_POOLS_PER_CALL);
    const calls = part.flatMap(p => [
      { target: p.id as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi, functionName: 'slot0' }) },
      { target: p.quote as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi, functionName: 'balanceOf', args: [p.id as `0x${string}`] }) },
    ]);
    const data = await call(MULTICALL3, encodeFunctionData({ abi, functionName: 'aggregate3', args: [calls] }));
    const res = decodeFunctionResult({ abi, functionName: 'aggregate3', data }) as readonly { success: boolean; returnData: `0x${string}` }[];
    part.forEach((p, j) => {
      const s = res[2 * j]!, b = res[2 * j + 1]!;
      if (!s.success || !b.success || s.returnData.length < 66) return;
      const [sq] = decodeFunctionResult({ abi, functionName: 'slot0', data: s.returnData }) as readonly [bigint, ...unknown[]];
      const qDec = USD_QUOTES[p.quote]!;
      const price = priceFromSqrt(sq, p.token_is0 === 1, decimals.get(p.token)!, qDec);
      if (price == null) return;
      const bal = decodeFunctionResult({ abi, functionName: 'balanceOf', data: b.returnData }) as bigint;
      out.push({ id: p.id, token: p.token, priceUsd: price, liquidityUsd: liquidityUsd(bal, qDec, 2) ?? 0 });
    });
  }
  return out;
}

export function savePoolReads(db: DB, reads: PoolRead[]): void {
  const up = db.prepare(`UPDATE pools SET price_usd = ?, liquidity_usd = ?, read_at = ? WHERE id = ?`);
  const t = now();
  db.transaction(() => { for (const r of reads) up.run(r.priceUsd, r.liquidityUsd, t, r.id); })();
}

export function poolsOf(db: DB, tokens: string[]): PoolRow[] {
  const q = db.prepare(`SELECT id, kind, token, quote, token_is0, fee, hooks, block, ts FROM pools WHERE token = ?`);
  return tokens.flatMap(t => q.all(t) as PoolRow[]);
}
