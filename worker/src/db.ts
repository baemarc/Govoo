import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  id              INTEGER PRIMARY KEY,
  address         TEXT NOT NULL UNIQUE,
  source          TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  code_kind       TEXT,
  code_checked_at INTEGER
);

CREATE TABLE IF NOT EXISTS wallet_labels (
  wallet_id  INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  category   TEXT NOT NULL CHECK (category IN ('smart','whale','fomo','candidate')),
  label      TEXT,
  meta       TEXT,
  valid_from INTEGER NOT NULL,
  valid_to   INTEGER,
  PRIMARY KEY (wallet_id, category, valid_from)
);
CREATE INDEX IF NOT EXISTS wallet_labels_open ON wallet_labels(category) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS wallet_blacklist (
  address  TEXT PRIMARY KEY,
  reason   TEXT,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS token_blacklist (
  address  TEXT PRIMARY KEY,
  reason   TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS legs (
  tx_hash   TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block     INTEGER NOT NULL,
  ts        INTEGER NOT NULL,
  token     TEXT NOT NULL,
  "from"    TEXT NOT NULL,
  "to"      TEXT NOT NULL,
  amount    TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS legs_block ON legs(block);
CREATE INDEX IF NOT EXISTS legs_from ON legs("from", block);
CREATE INDEX IF NOT EXISTS legs_to ON legs("to", block);

CREATE TABLE IF NOT EXISTS trades (
  tx_hash      TEXT NOT NULL,
  wallet_id    INTEGER NOT NULL,
  token        TEXT NOT NULL,
  block        INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('buy','sell')),
  token_amount TEXT NOT NULL,
  usdc_amount  TEXT,
  usd          REAL,
  counter      TEXT NOT NULL,
  below_floor  INTEGER NOT NULL DEFAULT 0,
  via          TEXT NOT NULL DEFAULT 'direct',
  PRIMARY KEY (tx_hash, wallet_id, token)
);
CREATE INDEX IF NOT EXISTS trades_ts ON trades(ts);
CREATE INDEX IF NOT EXISTS trades_token_ts ON trades(token, ts);
CREATE INDEX IF NOT EXISTS trades_wallet_ts ON trades(wallet_id, ts);

CREATE TABLE IF NOT EXISTS transfers (
  tx_hash      TEXT NOT NULL,
  wallet_id    INTEGER NOT NULL,
  token        TEXT NOT NULL,
  block        INTEGER NOT NULL,
  ts           INTEGER NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount       TEXT NOT NULL,
  counterparty TEXT,
  PRIMARY KEY (tx_hash, wallet_id, token)
);
CREATE INDEX IF NOT EXISTS transfers_wallet_ts ON transfers(wallet_id, ts);
CREATE INDEX IF NOT EXISTS transfers_cp ON transfers(counterparty);

CREATE TABLE IF NOT EXISTS relay_checks (
  tx_hash    TEXT NOT NULL,
  wallet_id  INTEGER NOT NULL,
  token      TEXT NOT NULL,
  party      TEXT,
  usdc       TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, wallet_id, token)
);

CREATE TABLE IF NOT EXISTS tokens (
  address         TEXT PRIMARY KEY,
  symbol          TEXT,
  name            TEXT,
  decimals        INTEGER,
  total_supply    TEXT,
  deployer        TEXT,
  created_block   INTEGER,
  logo_url        TEXT,
  meta_checked_at INTEGER
);

CREATE TABLE IF NOT EXISTS price_history (
  token     TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  price_usd REAL NOT NULL,
  PRIMARY KEY (token, hour)
);

CREATE TABLE IF NOT EXISTS prices (
  token         TEXT PRIMARY KEY,
  price_usd     REAL,
  mcap_usd      REAL,
  liquidity_usd REAL,
  change_24h    REAL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pools (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  token         TEXT NOT NULL,
  quote         TEXT NOT NULL,
  token_is0     INTEGER NOT NULL,
  fee           INTEGER,
  hooks         TEXT,
  block         INTEGER NOT NULL,
  ts            INTEGER,
  price_usd     REAL,
  liquidity_usd REAL,
  read_at       INTEGER
);
CREATE INDEX IF NOT EXISTS pools_token ON pools(token);

CREATE TABLE IF NOT EXISTS whale_tokens (
  token           TEXT PRIMARY KEY,
  symbol          TEXT,
  added_at        INTEGER NOT NULL,
  last_scanned_at INTEGER,
  next_scan_at    INTEGER,
  scan_status     TEXT NOT NULL DEFAULT 'pending',
  scan_error      TEXT,
  whale_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS whale_scans (
  wallet_id     INTEGER NOT NULL,
  token         TEXT NOT NULL,
  rank          INTEGER,
  pct_of_supply REAL,
  value_usd     REAL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  PRIMARY KEY (wallet_id, token)
);

CREATE TABLE IF NOT EXISTS cursor (
  name  TEXT PRIMARY KEY,
  block INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backfill_jobs (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  wallet_ids  TEXT NOT NULL,
  from_block  INTEGER NOT NULL,
  to_block    INTEGER NOT NULL,
  next_block  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

const COLUMNS: [table: string, column: string, def: string][] = [
  ['tokens', 'pair_created_at', 'INTEGER'],
  ['wallets', 'bot_at', 'INTEGER'],
  ['wallets', 'bot_meta', 'TEXT'],
  ['prices', 'source', 'TEXT'],
  ['prices', 'pool', 'TEXT'],
  ['tokens', 'ds_checked_at', 'INTEGER'],
  ['tokens', 'ds_prefer', 'INTEGER'],
  ['tokens', 'unpriced_at', 'INTEGER'],
  ['trades', 'dirty_at', 'INTEGER'],
];

export function openDb(file = env.dbPath): DB {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  for (const [t, c, def] of COLUMNS) {
    const has = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).some(r => r.name === c);
    if (!has) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS trades_dirty ON trades(dirty_at) WHERE dirty_at IS NOT NULL`);
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);
