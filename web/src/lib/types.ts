export type Cat = 'smart' | 'whale' | 'fomo';
export type CatAll = Cat | 'all';

export interface Token {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  logo_url: string | null;
  pair_created_at: string | null;
  price_usd: number | null;
  mcap_usd: number | null;
  liquidity_usd: number | null;
  change_24h: number | null;
  total_supply: number | null;
  updated_at: string;
}

export interface Who { id: number; l: string; c: Cat; usd: number | null }

export interface BoardRow {
  token: string;
  win: string;
  category: CatAll;
  inflow: number;
  outflow: number;
  net: number;
  buyers: number;
  sellers: number;
  trades: number;
  top_share: number | null;
  holders: number;
  holders_delta: number;
  sm_usd: number | null;
  supply_pct: number | null;
  who: Who[];
  holders_cat?: Record<Cat, number> | null;
}

export interface Trade {
  id: string;
  token: string;
  wallet_id: number;
  category: Cat;
  side: 'buy' | 'sell';
  token_qty: number;
  usd: number | null;
  ts: string;
  below_floor: boolean;
  via: string;
}

export interface Position {
  wallet_id: number;
  token: string;
  qty: number;
  costed_qty: number;
  cost_usd: number;
  costless_qty: number;
  realized_usd: number;
  value_usd: number | null;
}

export interface WalletPublic { wallet_id: number; category: Cat; label: string }
export interface Rotation { win: string; from_token: string; to_token: string; usd: number }
export interface WorkerStatus { last_block: number | null; last_round_at: string | null; error_count: number; last_error: string | null }
