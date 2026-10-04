# Govoo

Smart money flow tracker for Arc mainnet.

Govoo follows a set of tracked wallets (smart, whale, fomo), decodes their on-chain trades
and shows how much money flows into and out of each token across several time windows.

The repository contains the application only. Tracked wallet lists and data are not included.

## Structure

| Path | What it is |
| --- | --- |
| `worker/` | Node.js worker. Reads Arc logs, resolves trades, prices tokens, publishes to Supabase. |
| `web/` | React + Vite frontend. Reads the published data from Supabase. |
| `supabase/schema.sql` | Database schema, row level security and permissions. |

## Requirements

- Node.js 20 or newer
- A Supabase project
- An Arc mainnet RPC endpoint (the public one works)

## Setup

### 1. Database

Open the Supabase SQL editor and run `supabase/schema.sql`.

To use the admin page, create a user under Authentication, then register it as an admin:

```sql
insert into public.admin_users (user_id) values ('<auth user id>');
```

### 2. Worker

```bash
cp .env.example .env
```

Fill in `.env` at the repository root:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: from your Supabase project settings.
- `GOVOO_HMAC_KEY`: any long random string.
- Rule thresholds (`MIN_TRADE_USD`, `SMART_*`, `BOT_*`, `SYBIL_*`, `CAND_*`, `WHALE_*`,
  `DS_PREFER_RATIO`): these have no defaults. Choose your own values. The worker will not
  start until all of them are set.

Then:

```bash
cd worker
npm install
npm start
```

The worker keeps its raw data in a local SQLite file (`worker/data/`) and publishes a
snapshot to Supabase every few minutes. `npm start -- --once` runs a single round and exits.

Optional: `RPC_MIN_GAP_MS` sets the minimum delay between RPC calls, if your endpoint
rate-limits.

### 3. Frontend

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `web/.env.local`. The anon key is
public by design; row level security only allows reads.

To deploy, point your host (for example Vercel) at the `web` directory with the same two
environment variables.
