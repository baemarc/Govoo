export interface Market {
  token: string;
  symbol: string | null;
  name: string | null;
  priceUsd: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  change24h: number | null;
  pairCreatedAt: number | null;
  logoUrl: string | null;
  pairAddress: string | null;
  dexId: string | null;
  labels: string[];
  quoteAddress: string | null;
}

interface Pair {
  baseToken: { address: string; symbol?: string; name?: string };
  quoteToken?: { address?: string };
  pairAddress?: string;
  dexId?: string;
  labels?: string[];
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

const BATCH = 30;

async function getPairs(url: string): Promise<Pair[]> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as Pair[];
    if (res.status !== 429 || i >= 4) throw new Error(`DexScreener HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 15_000 * (i + 1)));
  }
}
const GAP_MS = 1100;

export async function fetchMarkets(tokens: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  const liq = new Map<string, number>();
  for (let i = 0; i < tokens.length; i += BATCH) {
    if (i) await new Promise(r => setTimeout(r, GAP_MS));
    const url = `https://api.dexscreener.com/tokens/v1/arc/${tokens.slice(i, i + BATCH).join(',')}`;
    for (const p of await getPairs(url)) {
      const token = p.baseToken.address.toLowerCase();
      const l = p.liquidity?.usd ?? 0;
      if ((liq.get(token) ?? -1) >= l) continue;
      liq.set(token, l);
      out.set(token, {
        token,
        symbol: p.baseToken.symbol ?? null,
        name: p.baseToken.name ?? null,
        priceUsd: p.priceUsd != null ? Number(p.priceUsd) : null,
        mcapUsd: p.marketCap ?? p.fdv ?? null,
        liquidityUsd: p.liquidity?.usd ?? null,
        change24h: p.priceChange?.h24 ?? null,
        pairCreatedAt: p.pairCreatedAt ? Math.floor(p.pairCreatedAt / 1000) : null,
        logoUrl: p.info?.imageUrl ?? null,
        pairAddress: p.pairAddress?.toLowerCase() ?? null,
        dexId: p.dexId ?? null,
        labels: p.labels ?? [],
        quoteAddress: p.quoteToken?.address?.toLowerCase() ?? null,
      });
    }
  }
  return out;
}
