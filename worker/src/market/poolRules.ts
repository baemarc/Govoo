import { num } from '../config.js';
import { concat, keccak256, pad, toHex } from 'viem';
import { USDC_MIRROR } from '../chain.js';
import type { RawLog } from '../rpc.js';

export const V4_POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
export const V3_FACTORY = '0xf0db7b58379503491d857db50ac9ece64c653918';
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
export const NATIVE = '0x0000000000000000000000000000000000000000';

export const TOPIC_V3_POOL_CREATED = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118';
export const TOPIC_V4_INITIALIZE = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';

export const USD_QUOTES: Record<string, number> = { [USDC_MIRROR]: 6, [NATIVE]: 18 };

export interface PoolRow {
  id: string;
  kind: 'v3' | 'v4';
  token: string;
  quote: string;
  token_is0: 0 | 1;
  fee: number;
  hooks: string | null;
  block: number;
  ts: number | null;
}

const topicAddr = (t: string) => '0x' + t.slice(26).toLowerCase();
const word = (data: string, i: number) => data.slice(2 + 64 * i, 2 + 64 * (i + 1));

export function parsePoolLog(l: RawLog): PoolRow | null {
  const emitter = l.address.toLowerCase();
  const t = l.topics;
  let kind: 'v3' | 'v4', id: string, t0: string, t1: string, fee: number, hooks: string | null = null;
  if (emitter === V4_POOL_MANAGER && t[0] === TOPIC_V4_INITIALIZE && t.length === 4) {
    kind = 'v4'; id = t[1]!.toLowerCase(); t0 = topicAddr(t[2]!); t1 = topicAddr(t[3]!);
    fee = Number(BigInt('0x' + word(l.data, 0)));
    hooks = '0x' + word(l.data, 2).slice(24).toLowerCase();
  } else if (emitter === V3_FACTORY && t[0] === TOPIC_V3_POOL_CREATED && t.length === 4) {
    kind = 'v3'; id = '0x' + word(l.data, 1).slice(24).toLowerCase(); t0 = topicAddr(t[1]!); t1 = topicAddr(t[2]!);
    fee = Number(BigInt(t[3]!));
  } else return null;
  const q0 = t0 in USD_QUOTES, q1 = t1 in USD_QUOTES;
  if (q0 === q1) return null;
  return {
    id, kind, token: q0 ? t1 : t0, quote: q0 ? t0 : t1, token_is0: q0 ? 0 : 1, fee, hooks,
    block: Number(l.blockNumber), ts: l.blockTimestamp ? Number(l.blockTimestamp) : null,
  };
}

export function v4StateSlot(poolId: string): `0x${string}` {
  return keccak256(concat([poolId as `0x${string}`, pad(toHex(6n), { size: 32 })]));
}
export function v4LiquiditySlot(stateSlot: string): `0x${string}` {
  return toHex(BigInt(stateSlot) + 3n, { size: 32 });
}
export function sqrtPriceFromWord(w: string | bigint): bigint {
  return BigInt(w) & ((1n << 160n) - 1n);
}
export function tickFromWord(w: string | bigint): number {
  return Number(BigInt.asIntN(24, (BigInt(w) >> 160n) & ((1n << 24n) - 1n)));
}
export function liquidityFromWord(w: string | bigint): bigint {
  return BigInt(w) & ((1n << 128n) - 1n);
}

const Q96 = 2 ** 96;
const finite = (v: number) => Number.isFinite(v) && v > 0;

export function priceFromSqrt(sqrtPriceX96: bigint, tokenIs0: boolean, tokenDecimals: number | null, quoteDecimals: number): number | null {
  if (tokenDecimals == null || !Number.isInteger(tokenDecimals) || sqrtPriceX96 <= 0n) return null;
  const p1per0 = (Number(sqrtPriceX96) / Q96) ** 2;
  if (!finite(p1per0)) return null;
  const price = (tokenIs0 ? p1per0 : 1 / p1per0) * 10 ** (tokenDecimals - quoteDecimals);
  return finite(price) ? price : null;
}

export function v4QuoteReserveRaw(liquidity: bigint, sqrtPriceX96: bigint, tokenIs0: boolean): bigint | null {
  if (liquidity <= 0n || sqrtPriceX96 <= 0n) return null;
  const q96 = 1n << 96n;
  return tokenIs0 ? (liquidity * sqrtPriceX96) / q96 : (liquidity * q96) / sqrtPriceX96;
}

export function liquidityUsd(quoteRaw: bigint | null, quoteDecimals: number, sides: 1 | 2): number | null {
  if (quoteRaw == null) return null;
  const v = (Number(quoteRaw) / 10 ** quoteDecimals) * sides;
  return Number.isFinite(v) && v >= 0 ? v : null;
}

export interface PoolQuote { id: string; priceUsd: number; liquidityUsd: number }

export function pickBest(quotes: PoolQuote[]): PoolQuote | null {
  let best: PoolQuote | null = null;
  for (const q of quotes) if (!best || q.liquidityUsd > best.liquidityUsd) best = q;
  return best;
}

export interface DsPair { pairAddress: string | null; dexId: string | null; labels: string[]; quoteAddress: string | null; liquidityUsd: number | null; pairCreatedAt: number | null }

export const DS_PREFER_RATIO = num('DS_PREFER_RATIO');

export type DsVerdict = { kind: 'ok' } | { kind: 'add'; pool: PoolRow } | { kind: 'prefer' };

export function dsVerdict(token: string, ds: DsPair | undefined, known: Set<string>, chainLiq: number | null): DsVerdict {
  if (!ds?.pairAddress || known.has(ds.pairAddress)) return { kind: 'ok' };
  const kind = ds.labels.includes('v4') ? 'v4' : ds.labels.includes('v3') ? 'v3' : null;
  const quote = ds.quoteAddress;
  if (ds.dexId === 'uniswap' && kind && quote && quote in USD_QUOTES && (kind === 'v4') === (ds.pairAddress.length === 66)) {
    return { kind: 'add', pool: {
      id: ds.pairAddress, kind, token, quote, token_is0: token < quote ? 1 : 0, fee: 0, hooks: null, block: 0, ts: ds.pairCreatedAt,
    } };
  }
  return (ds.liquidityUsd ?? 0) > DS_PREFER_RATIO * (chainLiq ?? 0) ? { kind: 'prefer' } : { kind: 'ok' };
}
