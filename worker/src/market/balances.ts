import { erc20Abi, parseAbi } from 'viem';
import { USDC } from '../chain.js';
import { now, type DB } from '../db.js';
import { client } from './tokenMeta.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const ABI_ETH_BALANCE = parseAbi(['function getEthBalance(address) view returns (uint256)']);
const CHUNK = 400;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS token_balances (
  wallet_id INTEGER NOT NULL, token TEXT NOT NULL, balance TEXT NOT NULL, checked_at INTEGER NOT NULL,
  PRIMARY KEY (wallet_id, token)
);
CREATE TABLE IF NOT EXISTS usdc_balances (
  wallet_id INTEGER PRIMARY KEY, balance TEXT NOT NULL, checked_at INTEGER NOT NULL
);`;

export async function refreshTokenBalances(db: DB): Promise<number> {
  db.exec(SCHEMA);
  const pairs = db.prepare(
    `SELECT DISTINCT p.wallet_id, p.token, w.address FROM (
       SELECT wallet_id, token FROM trades UNION SELECT wallet_id, token FROM transfers WHERE token != ?
     ) p JOIN wallets w ON w.id = p.wallet_id`,
  ).all(USDC) as { wallet_id: number; token: string; address: string }[];
  const up = db.prepare(`INSERT OR REPLACE INTO token_balances VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const part = pairs.slice(i, i + CHUNK);
    const res = await client.multicall({
      contracts: part.map(p => ({ address: p.token as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf' as const,
        args: [p.address as `0x${string}`] as const })),
      allowFailure: true, batchSize: 0,
    });
    db.transaction(() => part.forEach((p, j) => {
      const r = res[j];
      if (r?.status === 'success') up.run(p.wallet_id, p.token, String(r.result), now());
    }))();
  }
  return pairs.length;
}

export async function refreshUsdcBalances(db: DB): Promise<number> {
  db.exec(SCHEMA);
  const wallets = db.prepare(`SELECT id, address FROM wallets`).all() as { id: number; address: string }[];
  const up = db.prepare(`INSERT OR REPLACE INTO usdc_balances VALUES (?, ?, ?)`);
  for (let i = 0; i < wallets.length; i += CHUNK) {
    const part = wallets.slice(i, i + CHUNK);
    const res = await client.multicall({
      contracts: part.map(w => ({ address: MULTICALL3, abi: ABI_ETH_BALANCE, functionName: 'getEthBalance' as const,
        args: [w.address as `0x${string}`] as const })),
      allowFailure: true, batchSize: 0,
    });
    db.transaction(() => part.forEach((w, j) => {
      const r = res[j];
      if (r?.status === 'success') up.run(w.id, String(r.result), now());
    }))();
  }
  return wallets.length;
}
