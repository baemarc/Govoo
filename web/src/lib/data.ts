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
