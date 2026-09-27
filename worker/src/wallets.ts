import { now, type DB } from './db.js';

export function removeWallet(db: DB, id: number, reason: string): void {
  const w = db.prepare(`SELECT address FROM wallets WHERE id = ?`).get(id) as { address: string } | undefined;
  if (!w) return;
  db.transaction(() => {
    for (const t of ['trades', 'transfers', 'relay_checks', 'whale_scans', 'wallet_labels']) {
      db.prepare(`DELETE FROM ${t} WHERE wallet_id = ?`).run(id);
    }
    db.prepare(
      `DELETE FROM legs WHERE ("from" = @a AND "to" NOT IN (SELECT address FROM wallets WHERE id != @id))
                          OR ("to" = @a AND "from" NOT IN (SELECT address FROM wallets WHERE id != @id))`,
    ).run({ a: w.address, id });
    for (const j of db.prepare(`SELECT id, name, wallet_ids FROM backfill_jobs`).all() as { id: number; name: string; wallet_ids: string }[]) {
      const ids = (JSON.parse(j.wallet_ids) as number[]).filter(x => x !== id);
      if (!ids.length && j.name.startsWith('admin-')) db.prepare(`DELETE FROM backfill_jobs WHERE id = ?`).run(j.id);
      else db.prepare(`UPDATE backfill_jobs SET wallet_ids = ? WHERE id = ?`).run(JSON.stringify(ids), j.id);
    }
    db.prepare(`DELETE FROM wallets WHERE id = ?`).run(id);
    db.prepare(`INSERT OR REPLACE INTO wallet_blacklist (address, reason, added_at) VALUES (?, ?, ?)`)
      .run(w.address, reason, now());
  })();
}

export function unblacklistWallet(db: DB, address: string): void {
  db.prepare(`DELETE FROM wallet_blacklist WHERE address = ?`).run(address.toLowerCase());
}

export function addWallet(db: DB, address: string, category: 'smart' | 'whale' | 'fomo' | 'candidate', label: string | null,
  fromBlock: number, opts: { source?: string; validFrom?: number; meta?: object; noBackfill?: boolean } = {}): number | null {
  const addr = address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr) || db.prepare(`SELECT 1 FROM wallet_blacklist WHERE address = ?`).get(addr)) return null;
  return db.transaction(() => {
    if (!db.prepare(`SELECT 1 FROM wallets WHERE address = ?`).get(addr)) {
      db.prepare(`INSERT INTO wallets (id, address, source, added_at) VALUES (?, ?, ?, ?)`)
        .run(nextWalletId(db), addr, opts.source ?? 'admin', now());
    }
    const { id } = db.prepare(`SELECT id FROM wallets WHERE address = ?`).get(addr) as { id: number };
    if (!db.prepare(`SELECT 1 FROM wallet_labels WHERE wallet_id = ? AND category = ? AND valid_to IS NULL`).get(id, category)) {
      db.prepare(`INSERT INTO wallet_labels (wallet_id, category, label, meta, valid_from) VALUES (?, ?, ?, ?, ?)`)
        .run(id, category, label, opts.meta ? JSON.stringify(opts.meta) : null, opts.validFrom ?? now());
    }
    if (!opts.noBackfill && !hasHistory(db, id)) addBackfillJob(db, `admin-${id}`, [id], fromBlock);
    return id;
  })();
}

export function nextWalletId(db: DB): number {
  const hwm = (db.prepare(`SELECT block FROM cursor WHERE name = 'wallet_id_hwm'`).get() as { block: number } | undefined)?.block ?? 0;
  const max = (db.prepare(`SELECT max(id) AS m FROM wallets`).get() as { m: number | null }).m ?? 0;
  const id = Math.max(hwm, max) + 1;
  db.prepare(`INSERT INTO cursor (name, block) VALUES ('wallet_id_hwm', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`).run(id);
  return id;
}

export function hasHistory(db: DB, id: number): boolean {
  return !!db.prepare(`SELECT 1 FROM backfill_jobs WHERE EXISTS
    (SELECT 1 FROM json_each(wallet_ids) WHERE value = ?)`).get(id);
}

export function addBackfillJob(db: DB, name: string, ids: number[], fromBlock: number): void {
  const live = db.prepare(`SELECT block FROM cursor WHERE name = 'live'`).get() as { block: number } | undefined;
  if (!live || !ids.length) return;
  db.prepare(`INSERT INTO backfill_jobs (name, wallet_ids, from_block, to_block, next_block, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, JSON.stringify(ids), fromBlock, live.block, fromBlock, now(), now());
}

export function dropContractWhales(db: DB): { removed: number; unlabeled: number } {
  const rows = db.prepare(
    `SELECT w.id, (SELECT count(*) FROM wallet_labels l WHERE l.wallet_id = w.id AND l.valid_to IS NULL
                   AND l.category IN ('smart', 'fomo')) AS other
     FROM wallets w JOIN wallet_labels l ON l.wallet_id = w.id AND l.category = 'whale' AND l.valid_to IS NULL
     WHERE w.code_kind = 'contract'`,
  ).all() as { id: number; other: number }[];
  let removed = 0, unlabeled = 0;
  for (const r of rows) {
    if (r.other === 0) { removeWallet(db, r.id, 'contract (whale scan)'); removed++; }
    else {
      db.prepare(`UPDATE wallet_labels SET valid_to = ? WHERE wallet_id = ? AND category = 'whale' AND valid_to IS NULL`)
        .run(now(), r.id);
      unlabeled++;
    }
  }
  return { removed, unlabeled };
}
