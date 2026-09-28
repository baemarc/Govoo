import { sb } from './supabase';
import type { Token, WalletPublic } from './types';

const PAGE = 1000;

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

export async function fetchAll<T>(make: () => { range(from: number, to: number): Res<T[]> }): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const data = await must(make().range(from, from + PAGE - 1));
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function must<T>(p: Res<T>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

const tokenCache = new Map<string, Token | null>();
export async function tokensFor(addrs: string[]): Promise<Map<string, Token>> {
  const miss = [...new Set(addrs)].filter(a => !tokenCache.has(a));
  const chunks: string[][] = [];
  for (let i = 0; i < miss.length; i += 100) chunks.push(miss.slice(i, i + 100));
  await Promise.all(chunks.map(async c => {
    const rows = (await must(sb.from('tokens').select('*').in('address', c))) as Token[] | null;
    const got = new Map((rows ?? []).map(t => [t.address, t]));
    for (const a of c) tokenCache.set(a, got.get(a) ?? null);
  }));
  const out = new Map<string, Token>();
  for (const a of addrs) { const t = tokenCache.get(a); if (t) out.set(a, t); }
  return out;
}

let tokensP: Promise<Map<string, Token>> | null = null;
export function tokenMap(): Promise<Map<string, Token>> {
  tokensP ??= fetchAll<Token>(() => sb.from('tokens').select('*').order('address'))
    .then(rows => new Map(rows.map(t => [t.address, t])))
    .catch(e => { tokensP = null; throw e; });
  return tokensP;
}

let walletsP: Promise<Map<number, WalletPublic>> | null = null;
export function walletMap(): Promise<Map<number, WalletPublic>> {
  walletsP ??= fetchAll<WalletPublic>(() => sb.from('wallets_public').select('*').order('wallet_id'))
    .then(rows => new Map(rows.map(w => [w.wallet_id, w])))
    .catch(e => { walletsP = null; throw e; });
  return walletsP;
}
