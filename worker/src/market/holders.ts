import { now, type DB } from '../db.js';

const SCHEMA = `CREATE TABLE IF NOT EXISTS holder_counts (
  token TEXT NOT NULL, ts INTEGER NOT NULL, holders INTEGER NOT NULL, PRIMARY KEY (token, ts)
);`;

const FAIL_LIMIT = 3;

export async function holderRound(db: DB): Promise<number> {
  db.exec(SCHEMA);
  const tokens = (db.prepare(
    `SELECT token FROM calc_board WHERE win = '1w' AND category = 'all' ORDER BY inflow + outflow DESC LIMIT 300`,
  ).all() as { token: string }[]).map(r => r.token);
  const ins = db.prepare(`INSERT OR REPLACE INTO holder_counts VALUES (?, ?, ?)`);
  const t = now();
  let n = 0, fails = 0;
  for (const token of tokens) {
    if (fails >= FAIL_LIMIT) break;
    try {
      const res = await fetch(`https://arcexplorer.org/api/v1/tokens/${token}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) { fails++; continue; }
      const body = (await res.json()) as { holderCount?: number | string };
      if (body.holderCount == null) continue;
      ins.run(token, t, Number(body.holderCount));
      n++;
      fails = 0;
    } catch { fails++;  }
    await new Promise(r => setTimeout(r, 300));
  }
  return n;
}
