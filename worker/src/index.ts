import { openDb, now, type DB } from './db.js';
import { blockNumber, rpcStats } from './rpc.js';
import { enrichRelayHistory, enrichRelays, loadWallets, relayRouters, scanRange } from './scan/scanner.js';
import { classifyWallets } from './scan/codeKind.js';
import { dropContractWhales } from './wallets.js';
import { dropBotWhales, markBotCandidates, markSybilClusters } from './bots.js';
import { smartRound } from './smart.js';
import { priceRound } from './market/prices.js';
import { refreshTokenBalances, refreshUsdcBalances } from './market/balances.js';
import { holderRound } from './market/holders.js';
import { whaleRound } from './market/whales.js';
import { candidateRound, walletScanStep } from './market/candidates.js';
import { computeBoard } from './calc/board.js';
import { publish, reportError } from './publish.js';

const ROUND_MS = 5 * 60_000;
const LIVE_STEP = 5000;
const BACKFILL_STEPS_PER_ROUND = 20;
const WHALE_SCAN = false;
const EVERY: Record<string, number> = { tokenBalances: 3600, holders: 4 * 3600, smart: 86_400 };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function due(db: DB, name: string): boolean {
  const r = db.prepare(`SELECT block FROM cursor WHERE name = ?`).get(`at_${name}`) as { block: number } | undefined;
  return !r || now() - r.block >= EVERY[name]!;
}
function mark(db: DB, name: string): void {
  db.prepare(`INSERT INTO cursor (name, block) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`)
    .run(`at_${name}`, now());
}

async function scanLive(db: DB): Promise<number> {
  const cur = db.prepare(`SELECT block FROM cursor WHERE name = 'live'`).get() as { block: number } | undefined;
  const head = await blockNumber();
  let from = (cur?.block ?? head - 1) + 1;
  const wallets = loadWallets(db);
  while (from <= head) {
    const to = Math.min(head, from + LIVE_STEP - 1);
    const r = await scanRange(db, from, to, wallets);
    db.prepare(`INSERT INTO cursor (name, block) VALUES ('live', ?) ON CONFLICT(name) DO UPDATE SET block = excluded.block`).run(to);
    log(`scan ${from}..${to}: +${r.legs} legs, ${r.txs} tx`);
    from = to + 1;
  }
  return head;
}

async function stepBackfills(db: DB): Promise<void> {
  const jobs = db.prepare(`SELECT id, wallet_ids, to_block, next_block FROM backfill_jobs
    WHERE status != 'done' AND name LIKE 'admin-%' ORDER BY id`).all() as
    { id: number; wallet_ids: string; to_block: number; next_block: number }[];
  let steps = 0;
  for (const j of jobs) {
    const wallets = loadWallets(db, JSON.parse(j.wallet_ids) as number[]);
    let next = j.next_block;
    while (next <= j.to_block && steps++ < BACKFILL_STEPS_PER_ROUND) {
      const to = Math.min(j.to_block, next + 9999);
      await scanRange(db, next, to, wallets);
      next = to + 1;
      db.prepare(`UPDATE backfill_jobs SET next_block = ?, status = ?, updated_at = ? WHERE id = ?`)
        .run(next, next > j.to_block ? 'done' : 'running', now(), j.id);
    }
  }
}

async function round(db: DB): Promise<void> {
  const t0 = Date.now();
  const sec: Record<string, number> = {};
  let lap = t0;
  const step = (name: string) => { const t = Date.now(); sec[name] = Math.round((t - lap) / 1000); lap = t; };
  const head = await scanLive(db); step('scan');
  await stepBackfills(db); step('backfill');
  const whales = WHALE_SCAN ? await whaleRound(db) : null;
  const bots = dropBotWhales(db);
  if (bots.removed || bots.unlabeled) log('whale bots dropped:', bots);
  step('whale');
  if (whales && (whales.scanned.length || whales.errors || whales.dropped)) {
    log(`whale: ${whales.scanned.map(w => `${w.symbol} ${w.whales} (+${w.added})`).join(', ')}`,
      { errors: whales.errors, dropped: whales.dropped });
  }
  const relay = await enrichRelays(db, 300, now() - 86_400); step('relay');
  if ((await classifyWallets(db)).length) dropContractWhales(db);
  step('codeKind');
  const prices = await priceRound(db); step('prices');
  await refreshUsdcBalances(db); step('usdc');
  if (due(db, 'tokenBalances')) { await refreshTokenBalances(db); mark(db, 'tokenBalances'); step('tokenBal'); }
  if (due(db, 'smart')) {
    log('smart:', { botCandidates: markBotCandidates(db), sybil: markSybilClusters(db), ...smartRound(db) });
    mark(db, 'smart'); step('smart');
  }
  const calc = computeBoard(db); step('calc');
  const pub = process.env.SUPABASE_URL ? await publish(db, head) : null; step('publish');
  if (due(db, 'holders')) { log(`holder: ${await holderRound(db)} token`); mark(db, 'holders'); step('holders'); }
  log(`round done ${((Date.now() - t0) / 1000).toFixed(0)} sn`, { sec, relay, prices, calc, pub, rpc: rpcStats.requests });
}

async function candidateLoop(db: DB): Promise<void> {
  let routers: string[] | null = null;
  for (;;) {
    let busy = false;
    try {
      const c = await candidateRound(db, 20);
      if (c.added || c.behind || c.pending) log('candidates:', c);
      const w = await walletScanStep(db, c.behind === 0 && c.pending === 0);
      if (w) log('candidate wallet scan:', w);
      if (w?.done) {
        db.prepare(`DELETE FROM cursor WHERE name IN ('at_smart', 'at_tokenBalances')`).run();
        log('candidate wallet scan done: smart round brought forward');
      }
      busy = c.behind > 0 || c.pending > 0 || (!!w && !w.done);
      if (!busy) {
        routers ??= relayRouters(db);
        const r = await enrichRelayHistory(db, routers);
        if (r.checked) log('relay history:', r);
        busy = r.left > 0;
      }
    } catch (e) {
      log('candidate loop error:', e);
    }
    await new Promise(r => setTimeout(r, busy ? 1000 : ROUND_MS));
  }
}

async function main(): Promise<void> {
  const db = openDb();
  if (!process.env.SUPABASE_URL) log('SUPABASE_URL not set: publishing skipped');
  if (process.argv.includes('--once')) return round(db);
  void candidateLoop(db);
  for (;;) {
    const started = Date.now();
    try {
      await round(db);
    } catch (e) {
      log('round error:', e);
      if (process.env.SUPABASE_URL) await reportError(e);
    }
    await new Promise(r => setTimeout(r, Math.max(10_000, ROUND_MS - (Date.now() - started))));
  }
}

main();
