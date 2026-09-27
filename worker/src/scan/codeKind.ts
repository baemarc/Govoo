import { now, type DB } from '../db.js';
import { rpc } from '../rpc.js';

export type CodeKind = 'eoa' | 'eoa7702' | 'contract';

export function codeKind(code: string): CodeKind {
  const c = code.toLowerCase();
  if (c === '0x' || c === '') return 'eoa';
  if (c.startsWith('0xef0100') && c.length === 2 + 46) return 'eoa7702';
  return 'contract';
}

export async function classifyWallets(db: DB, all = false): Promise<{ id: number; address: string; kind: CodeKind; size: number }[]> {
  const rows = db.prepare(`SELECT id, address FROM wallets ${all ? '' : 'WHERE code_kind IS NULL'}`)
    .all() as { id: number; address: string }[];
  const upd = db.prepare(`UPDATE wallets SET code_kind = ?, code_checked_at = ? WHERE id = ?`);
  const out: { id: number; address: string; kind: CodeKind; size: number }[] = [];
  for (const r of rows) {
    const code = await rpc<string>('eth_getCode', [r.address, 'latest']);
    const kind = codeKind(code);
    upd.run(kind, now(), r.id);
    out.push({ ...r, kind, size: (code.length - 2) / 2 });
  }
  return out;
}
