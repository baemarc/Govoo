import { env } from './config.js';

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockTimestamp?: string;
  transactionHash: string;
  logIndex: string;
}

export class RpcError extends Error {
  constructor(public code: number | undefined, message: string) {
    super(message);
  }
}

const MIN_GAP_MS = Number(process.env.RPC_MIN_GAP_MS ?? 1000);
let lastCallAt = 0;
let nextId = 1;

export const rpcStats = { requests: 0, retries: 0, errors: 0 };

async function pace(): Promise<void> {
  const slot = Math.max(Date.now(), lastCallAt + MIN_GAP_MS);
  lastCallAt = slot;
  const wait = slot - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}

async function callOnce(url: string, method: string, params: unknown[]): Promise<unknown> {
  await pace();
  rpcStats.requests++;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new RpcError(res.status, `HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string } };
  if (body.error) throw new RpcError(body.error.code, body.error.message);
  return body.result;
}

export async function rpcBatch<T>(method: string, paramsList: unknown[][]): Promise<(T | undefined)[]> {
  if (!paramsList.length) return [];
  await pace();
  rpcStats.requests++;
  const url = env.rpcUrls[0]!;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(paramsList.map((params, i) => ({ jsonrpc: '2.0', id: i, method, params }))),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new RpcError(res.status, `HTTP ${res.status}`);
  const body = (await res.json()) as { id: number; result?: T }[];
  const out: (T | undefined)[] = new Array(paramsList.length).fill(undefined);
  if (Array.isArray(body)) for (const r of body) if (r.result !== undefined) out[r.id] = r.result;
  return out;
}

export function isRangeError(e: unknown): boolean {
  const m = e instanceof Error ? e.message.toLowerCase() : '';
  if ((e instanceof RpcError && e.code === 429) || /rate|too many requests|throttl|capacity/.test(m)) return false;
  return /range|too many|limit|exceed|query returned more/.test(m);
}

export async function rpc<T>(method: string, params: unknown[], attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    for (const url of env.rpcUrls) {
      try {
        return (await callOnce(url, method, params)) as T;
      } catch (e) {
        lastErr = e;
        if (isRangeError(e)) throw e;
        rpcStats.retries++;
        console.log(`rpc retry (${method}): ${e instanceof RpcError ? e.code : ''} ${String(e)}`);
      }
    }
    const limited = lastErr instanceof RpcError && lastErr.code === 429;
    await new Promise(r => setTimeout(r, limited ? 15_000 * (i + 1) : 1000 * 2 ** i));
  }
  rpcStats.errors++;
  throw lastErr;
}

export const hex =(n: number | bigint) => '0x' + n.toString(16);

export async function blockNumber(): Promise<number> {
  return Number(await rpc<string>('eth_blockNumber', []));
}

export async function blockTimestamp(n: number): Promise<number> {
  const b = await rpc<{ timestamp: string } | null>('eth_getBlockByNumber', [hex(n), false]);
  if (!b) throw new Error(`block ${n} not found`);
  return Number(b.timestamp);
}

export async function blockAtTime(ts: number, hi?: number): Promise<number> {
  let lo = 1;
  hi ??= await blockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await blockTimestamp(mid)) < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function getLogs(filter: {
  fromBlock: number;
  toBlock: number;
  address?: string | string[];
  topics?: (string | string[] | null)[];
}): Promise<RawLog[]> {
  return rpc<RawLog[]>('eth_getLogs', [
    { ...filter, fromBlock: hex(filter.fromBlock), toBlock: hex(filter.toBlock) },
  ]);
}
