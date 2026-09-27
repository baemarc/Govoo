create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
$$;
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create policy admin_users_self on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create table public.wallets_public (
  wallet_id integer primary key,
  category  text not null check (category in ('smart', 'whale', 'fomo')),
  label     text not null
);

create table public.tokens (
  address         text primary key,
  symbol          text,
  name            text,
  decimals        integer,
  logo_url        text,
  pair_created_at timestamptz,
  price_usd       double precision,
  mcap_usd        double precision,
  liquidity_usd   double precision,
  change_24h      double precision,
  total_supply    double precision,
  updated_at      timestamptz not null default now()
);

create table public.trades (
  id          text primary key,
  token       text not null,
  wallet_id   integer not null,
  category    text not null,
  side        text not null check (side in ('buy', 'sell')),
  token_qty   double precision not null,
  usd         double precision,
  ts          timestamptz not null,
  below_floor boolean not null default false,
  via         text not null default 'direct'
);
create index trades_token_ts on public.trades (token, ts desc);

create table public.positions (
  wallet_id    integer not null,
  token        text not null,
  qty          double precision not null,
  costed_qty   double precision not null,
  cost_usd     double precision not null,
  costless_qty double precision not null,
  realized_usd double precision not null,
  value_usd    double precision,
  primary key (wallet_id, token)
);
create index positions_token on public.positions (token);

create table public.board_rows (
  token         text not null,
  win           text not null,
  category      text not null,
  inflow        double precision not null,
  outflow       double precision not null,
  net           double precision not null,
  buyers        integer not null,
  sellers       integer not null,
  trades        integer not null,
  top_share     double precision,
  holders       integer not null,
  holders_delta integer not null,
  sm_usd        double precision,
  supply_pct    double precision,
  who           jsonb not null default '[]',
  holders_cat   jsonb,
  primary key (token, win, category)
);
create index board_rows_view on public.board_rows (win, category, net desc);

create table public.rotations (
  win        text not null,
  from_token text not null,
  to_token   text not null,
  usd        double precision not null,
  primary key (win, from_token, to_token)
);

create table public.holder_counts (
  token   text not null,
  ts      timestamptz not null,
  holders integer not null,
  primary key (token, ts)
);

create table public.usdc_series (
  ts       timestamptz not null,
  category text not null,
  usd      double precision not null,
  primary key (ts, category)
);

create table public.worker_status (
  id            integer primary key default 1 check (id = 1),
  last_block    bigint,
  last_round_at timestamptz,
  error_count   integer not null default 0,
  last_error    text
);

create table public.wallets_admin (
  wallet_id integer primary key,
  address   text not null unique,
  source    text not null,
  added_at  timestamptz not null,
  label     text
);

create table public.token_blacklist (
  address  text primary key,
  reason   text,
  added_at timestamptz not null default now()
);
create table public.wallet_blacklist (
  address  text primary key,
  reason   text,
  added_at timestamptz not null default now()
);
create table public.whale_tokens (
  token           text primary key,
  symbol          text,
  added_at        timestamptz not null default now(),
  last_scanned_at timestamptz,
  whale_count     integer not null default 0
);
create table public.wallet_requests (
  id         bigint generated always as identity primary key,
  action     text not null check (action in ('add', 'remove', 'restore')),
  address    text not null,
  category   text check (category in ('smart', 'whale', 'fomo')),
  label      text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['wallets_public','tokens','trades','positions','board_rows','rotations',
                           'holder_counts','usdc_series','worker_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
  end loop;
  foreach t in array array['token_blacklist','wallet_blacklist','whale_tokens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
  foreach t in array array['wallets_admin','wallet_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;

drop policy wallet_blacklist_read on public.wallet_blacklist;

grant usage on schema public to anon, authenticated, service_role;

grant select on public.wallets_public, public.tokens, public.trades, public.positions,
  public.board_rows, public.rotations, public.holder_counts, public.usdc_series,
  public.worker_status, public.token_blacklist, public.whale_tokens
  to anon, authenticated;

grant select, insert, update, delete on public.token_blacklist, public.wallet_blacklist,
  public.whale_tokens, public.wallets_admin, public.wallet_requests
  to authenticated;
grant select on public.admin_users to authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant usage on all sequences in schema public to authenticated;

create or replace function public.publish_round(p_board jsonb, p_rotations jsonb, p_positions jsonb)
  returns void language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.board_rows where true;
  insert into public.board_rows select * from jsonb_populate_recordset(null::public.board_rows, p_board);
  delete from public.rotations where true;
  insert into public.rotations select * from jsonb_populate_recordset(null::public.rotations, p_rotations);
  delete from public.positions where true;
  insert into public.positions select * from jsonb_populate_recordset(null::public.positions, p_positions);
end $$;
revoke execute on function public.publish_round(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.publish_round(jsonb, jsonb, jsonb) to service_role;
