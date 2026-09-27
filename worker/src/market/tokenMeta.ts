import { createPublicClient, defineChain, erc20Abi, http } from 'viem';
import { CHAIN_ID } from '../chain.js';
import { env } from '../config.js';
import { now, type DB } from '../db.js';

const arc = defineChain({
  id: CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: env.rpcUrls } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const client = createPublicClient({ chain: arc, transport: http(env.rpcUrls[0], { retryCount: 3, retryDelay: 2000 }) });

export async function refreshTokenMeta(db: DB, tokens: string[], chunk = 150): Promise<number> {
  const stale = db.prepare(`SELECT meta_checked_at FROM tokens WHERE address = ?`);
  const todo = tokens.filter(t => {
    const r = stale.get(t) as { meta_checked_at: number | null } | undefined;
    return !r?.meta_checked_at || now() - r.meta_checked_at > 86_400;
  });
  const up = db.prepare(
    `INSERT INTO tokens (address, symbol, name, decimals, total_supply, meta_checked_at) VALUES (@a, @s, @n, @d, @ts, @at)
     ON CONFLICT(address) DO UPDATE SET symbol = coalesce(tokens.symbol, @s), name = coalesce(tokens.name, @n),
       decimals = coalesce(@d, tokens.decimals), total_supply = coalesce(@ts, tokens.total_supply), meta_checked_at = @at`,
  );
  for (let i = 0; i < todo.length; i += chunk) {
    const part = todo.slice(i, i + chunk);
    const calls = part.flatMap(a => (['decimals', 'totalSupply', 'symbol', 'name'] as const)
      .map(fn => ({ address: a as `0x${string}`, abi: erc20Abi, functionName: fn })));
    const res = await client.multicall({ contracts: calls, allowFailure: true, batchSize: 0 });
    db.transaction(() => {
      part.forEach((a, j) => {
        const v = (k: number) => (res[j * 4 + k]?.status === 'success' ? res[j * 4 + k]!.result : null);
        const s = (x: unknown) => (typeof x === 'string' ? x.slice(0, 64) : null);
        up.run({ a, d: v(0) != null ? Number(v(0)) : null, ts: v(1) != null ? String(v(1)) : null,
          s: s(v(2)), n: s(v(3)), at: now() });
      });
    })();
  }
  return todo.length;
}
