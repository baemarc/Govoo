import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { must, tokenMap, walletMap } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { BoardRow, Cat, CatAll, Position, Token, Trade } from '../lib/types';
import { CATS, HOLDER_WINDOWS, WINDOWS, labelOf, secsOf, winOf, type WinKey } from '../lib/windows';
import { age, dateTime, pct, price, qty, signedInt, tone, usd, usdExact } from '../lib/format';
import { CatTag, Panel, Seg, Status, TokenLogo, short, td, th } from '../components/ui';

const TRADE_PAGE = 50;

export default function TokenPage() {
  const address = (useParams().address ?? '').toLowerCase();
  const [params, setParams] = useSearchParams();
  const win = winOf(params.get('w'));
  const setWin = (w: WinKey) => {
    const p = new URLSearchParams(params);
    p.set('w', w);
    setParams(p, { replace: true });
  };

  const token = useAsync(async () => (await tokenMap()).get(address)
    ?? (await must(sb.from('tokens').select('*').eq('address', address).maybeSingle())) ?? null, [address]);
  const t = token.data ?? undefined;

  return (
    <div className="space-y-4">
      <Link to={`/?w=${win}`} className="text-xs text-ink-3 hover:text-ink-2">← Flow Board</Link>
      <Header t={t} address={address} loading={token.loading} />
      <Ladder address={address} win={win} onWin={setWin} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Trades address={address} win={win} onWin={setWin} t={t} />
        <Holders address={address} t={t} />
      </div>
      <Panel title="Chart">
        <div className="px-4 py-8 text-center text-sm text-ink-3">Price chart is coming after launch.</div>
      </Panel>
    </div>
  );
}

function Header({ t, address, loading }: { t: Token | undefined; address: string; loading: boolean }) {
  const links = [
    { href: `https://www.geckoterminal.com/arc/tokens/${address}`, label: 'GeckoTerminal' },
    { href: `https://dexscreener.com/arc/${address}`, label: 'DexScreener' },
    { href: `https://arcexplorer.org/token/${address}`, label: 'Explorer' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <TokenLogo t={t} size={40} />
        <div>
          <h1 className="text-lg font-semibold">
            {t?.symbol ?? (loading ? '…' : short(address))}
            <span className="ml-2 text-sm font-normal text-ink-3">{t?.name}</span>
          </h1>
          <button className="num text-xs text-ink-3 hover:text-ink-2" title="Copy address"
            onClick={() => navigator.clipboard?.writeText(address)}>{short(address)} ⧉</button>
        </div>
      </div>
      <Fact label="Price" value={price(t?.price_usd)} />
      <Fact label="24h" value={pct(t?.change_24h, 1, true)} cls={tone(t?.change_24h)} />
      <Fact label="MCap" value={usd(t?.mcap_usd)} />
      <Fact label="Liquidity" value={usd(t?.liquidity_usd)} />
      <Fact label="Age" value={age(t?.pair_created_at)} />
      <div className="ml-auto flex gap-3 text-xs">
        {links.map(l => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="text-ink-3 hover:text-ink">{l.label} ↗</a>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`num text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Ladder({ address, win, onWin }: { address: string; win: WinKey; onWin: (w: WinKey) => void }) {
  const [cat, setCat] = useState<CatAll>('all');
  const rows = useAsync(async () => (await must(sb.from('board_rows').select('*').eq('token', address))) as BoardRow[] ?? [], [address]);
  const counts = useAsync(async () => (await must(sb.from('holder_counts').select('ts, holders').eq('token', address)
    .gte('ts', new Date(Date.now() - 32 * 86_400_000).toISOString()).order('ts'))) as { ts: string; holders: number }[] ?? [], [address]);

  const by = useMemo(() => {
    const m = new Map<string, BoardRow>();
    for (const r of rows.data ?? []) m.set(`${r.win}|${r.category}`, r);
    return m;
  }, [rows.data]);

  function totalDelta(secs: number): number | null {
    const s = counts.data ?? [];
    if (s.length < 2) return null;
    const last = s[s.length - 1]!;
    const since = Date.parse(last.ts) - secs * 1000;
    let base: { holders: number } | undefined;
    for (const p of s) { if (Date.parse(p.ts) <= since) base = p; else break; }
    return base ? last.holders - base.holders : null;
  }

  return (
    <Panel title="Flow ladder" right={<Seg<CatAll> label="Category" value={cat} onChange={setCat} options={CATS} />}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Window</th>
              <th className={`${th} text-right`}>Inflow</th>
              <th className={`${th} text-right`}>Outflow</th>
              <th className={`${th} text-right`}>Net</th>
              <th className={`${th} text-right`}>Buyers</th>
              <th className={`${th} text-right`}>Sellers</th>
              <th className={`${th} text-right`}>Trades</th>
              <th className={`${th} text-right`} title="Tracked holders now, change over the window">Tracked holders</th>
              {cat === 'all' && <>
                <th className={`${th} text-right`}>Smart Δ</th>
                <th className={`${th} text-right`}>Whale Δ</th>
                <th className={`${th} text-right`}>Fomo Δ</th>
              </>}
              <th className={`${th} text-right`} title="Change in the token's total holder count (recorded every 4h)">All holders Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {WINDOWS.map(w => {
              const r = by.get(`${w.key}|${cat}`);
              const hw = HOLDER_WINDOWS.has(w.key);
              const catDelta = (c: Cat) => { const x = by.get(`${w.key}|${c}`); return hw && x ? signedInt(x.holders_delta) : '—'; };
              const tot = hw ? totalDelta(w.secs) : null;
              return (
                <tr key={w.key} onClick={() => onWin(w.key)}
                  className={`cursor-pointer ${w.key === win ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                  <td className={`${td} font-medium`}>{w.label}</td>
                  <td className={`${td} num text-right text-up`}>{r ? usd(r.inflow) : '—'}</td>
                  <td className={`${td} num text-right text-down`}>{r ? usd(r.outflow) : '—'}</td>
                  <td className={`${td} num text-right font-semibold ${tone(r?.net)}`}>{r ? usd(r.net, true) : '—'}</td>
                  <td className={`${td} num text-right`}>{r?.buyers ?? '—'}</td>
                  <td className={`${td} num text-right`}>{r?.sellers ?? '—'}</td>
                  <td className={`${td} num text-right text-ink-2`}>{r?.trades ?? '—'}</td>
                  <td className={`${td} num text-right`}>
                    {r ? <>{r.holders} <span className={`text-xs ${hw ? tone(r.holders_delta) : 'text-ink-3'}`}>{hw ? signedInt(r.holders_delta) : ''}</span></> : '—'}
                  </td>
                  {cat === 'all' && (['smart', 'whale', 'fomo'] as const).map(c => (
                    <td key={c} className={`${td} num text-right text-ink-2`}>{catDelta(c)}</td>
                  ))}
                  <td className={`${td} num text-right ${tone(tot)}`}>{tot == null ? '—' : signedInt(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Status loading={rows.loading && !rows.data} error={rows.error} />
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
        Holder change shows on 4h · 12h · 24h · 1w · 1M. Click a row to filter trades by that window.
      </p>
    </Panel>
  );
}

function Trades({ address, win, onWin, t }: { address: string; win: WinKey; onWin: (w: WinKey) => void; t: Token | undefined }) {
  const [page, setPage] = useState(0);
  const [key, setKey] = useState(`${address}|${win}`);
  if (key !== `${address}|${win}`) { setKey(`${address}|${win}`); setPage(0); }

  const wallets = useAsync(walletMap, []);
  const res = useAsync(async () => {
    const since = new Date(Date.now() - secsOf(win) * 1000).toISOString();
    const { data, error, count } = await sb.from('trades').select('*', { count: 'exact' })
      .eq('token', address).gte('ts', since).order('ts', { ascending: false })
      .range(page * TRADE_PAGE, page * TRADE_PAGE + TRADE_PAGE - 1);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Trade[], count: count ?? 0 };
  }, [address, win, page]);

  const pages = Math.max(1, Math.ceil((res.data?.count ?? 0) / TRADE_PAGE));
  return (
    <Panel title={<>Trades <span className="font-normal text-ink-3">· {labelOf(win)} · {res.data?.count ?? 0}</span></>}
      right={<Seg<WinKey> label="Window" value={win} onChange={onWin} options={WINDOWS.map(w => ({ key: w.key, label: w.label }))} />}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Time</th>
              <th className={th}>Wallet</th>
              <th className={th}>Side</th>
              <th className={`${th} text-right`}>{t?.symbol ?? 'Amount'}</th>
              <th className={`${th} text-right`}>USD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {res.data?.rows.map(r => (
              <tr key={r.id} className={r.below_floor ? 'opacity-50' : ''} title={r.below_floor ? 'Under $25: not counted as flow' : undefined}>
                <td className={`${td} num text-xs text-ink-2`}>{dateTime(r.ts)}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <CatTag c={r.category} />
                    <span className="max-w-32 truncate text-ink-2">{wallets.data?.get(r.wallet_id)?.label ?? ''}</span>
                  </div>
                </td>
                <td className={`${td} font-medium ${r.side === 'buy' ? 'text-up' : 'text-down'}`}>{r.side === 'buy' ? 'Buy' : 'Sell'}</td>
                <td className={`${td} num text-right`}>{qty(r.token_qty)}</td>
                <td className={`${td} num text-right`}>{usdExact(r.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Status loading={res.loading && !res.data} error={res.error}
        empty={!res.loading && !res.data?.rows.length ? 'No tracked-wallet trades in this window.' : undefined} />
      {pages > 1 && (
        <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-2 text-xs text-ink-3">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="hover:text-ink disabled:opacity-40">← Newer</button>
          <span className="num">{page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="hover:text-ink disabled:opacity-40">Older →</button>
        </div>
      )}
    </Panel>
  );
}

function Holders({ address, t }: { address: string; t: Token | undefined }) {
  const wallets = useAsync(walletMap, []);
  const res = useAsync(async () => ((await must(sb.from('positions').select('*').eq('token', address)
    .order('qty', { ascending: false }).limit(500))) ?? []) as Position[], [address]);
  const p = t?.price_usd ?? null;

  return (
    <Panel title={<>Tracked holders <span className="font-normal text-ink-3">· {res.data?.length ?? 0}</span></>}>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-line bg-surface">
            <tr>
              <th className={th}>Wallet</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-right`}>Supply</th>
              <th className={`${th} text-right`}>Value</th>
              <th className={`${th} text-right`} title="Average cost of the traded portion">Avg cost</th>
              <th className={`${th} text-right`} title="Unrealized PnL of the traded portion">Unrealized</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {res.data?.map(h => {
              const w = wallets.data?.get(h.wallet_id);
              const avg = h.costed_qty > 0 ? h.cost_usd / h.costed_qty : null;
              const upnl = p != null && h.costed_qty > 0 ? h.costed_qty * p - h.cost_usd : null;
              const costlessShare = h.qty > 0 ? h.costless_qty / h.qty : 0;
              return (
                <tr key={h.wallet_id}>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      {w && <CatTag c={w.category as Cat} />}
                      <span className="max-w-32 truncate text-ink-2">{w?.label ?? ''}</span>
                    </div>
                  </td>
                  <td className={`${td} num text-right`}>
                    {qty(h.qty)}
                    {costlessShare > 0.01 && (
                      <span className="ml-1 text-xs text-ink-3" title={`${qty(h.costless_qty)} arrived by transfer or before tracking: cost unknown`}>*</span>
                    )}
                  </td>
                  <td className={`${td} num text-right text-ink-2`}>{t?.total_supply ? pct((h.qty / t.total_supply) * 100, 2) : '—'}</td>
                  <td className={`${td} num text-right`}>{usd(h.value_usd)}</td>
                  <td className={`${td} num text-right text-ink-2`}>{avg == null ? '—' : price(avg)}</td>
                  <td className={`${td} num text-right ${tone(upnl)}`}>{usd(upnl, true)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Status loading={res.loading && !res.data} error={res.error}
        empty={!res.loading && !res.data?.length ? 'No tracked wallet holds this token.' : undefined} />
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
        * Part of the balance arrived by transfer or before tracking; avg cost and PnL cover the traded part only.
      </p>
    </Panel>
  );
}
