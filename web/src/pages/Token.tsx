import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { must, tokenMap, walletMap } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { BoardRow, Cat, CatAll, Position, Token, Trade } from '../lib/types';
import { CATS, HOLDER_WINDOWS, WINDOWS, labelOf, secsOf, winOf, type WinKey } from '../lib/windows';
import { age, ago, dateTime, pct, price, qty, tone, usd, usdExact } from '../lib/format';
import {
  CAT_LABEL, CAT_LIST, Card, CatDot, CatTag, Chip, Count, Delta, Donut, Gauge, Hint, MagBar, NetBar, Panel, Seg, SplitBar, Spark, Status,
  TokenLogo, short, td, th,
} from '../components/ui';

const TRADE_PAGE = 50;
type HolderPoint = { ts: string; holders: number };

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
  const rows = useAsync(async () => (await must(sb.from('board_rows').select('*').eq('token', address))) as BoardRow[] ?? [], [address]);
  const counts = useAsync(async () => (await must(sb.from('holder_counts').select('ts, holders').eq('token', address)
    .gte('ts', new Date(Date.now() - 32 * 86_400_000).toISOString()).order('ts'))) as HolderPoint[] ?? [], [address]);
  const t = token.data ?? undefined;

  const by = useMemo(() => {
    const m = new Map<string, BoardRow>();
    for (const r of rows.data ?? []) m.set(`${r.win}|${r.category}`, r);
    return m;
  }, [rows.data]);

  return (
    <div className="space-y-8">
      <Link to={`/?w=${win}`} className="group inline-flex items-center gap-2 text-xs font-medium text-ink-3 transition-colors hover:text-ink">
        <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>←</span> Flow Board
      </Link>
      <Hero t={t} address={address} loading={token.loading} by={by} counts={counts.data ?? []} />

      <section className="space-y-4">
        <div className="rise flex flex-wrap items-end justify-between gap-3" style={{ '--i': 2 } as CSSProperties}>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em]">Flow in the last {labelOf(win)}</h2>
            <p className="mt-1 text-sm text-ink-3">All tracked wallets. Pick a window to update the cards, trades and table.</p>
          </div>
          <div className="w-full min-w-0 sm:w-auto">
            <Seg<WinKey> label="Time window" value={win} onChange={setWin} options={WINDOWS.map(w => ({ key: w.key, label: w.label }))} />
          </div>
        </div>
        <WindowCards r={by.get(`${win}|all`)} win={win} loading={rows.loading && !rows.data} />
      </section>

      <Ladder by={by} counts={counts.data ?? []} win={win} onWin={setWin} loading={rows.loading && !rows.data} error={rows.error} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Trades address={address} win={win} t={t} />
        <Holders address={address} t={t} />
      </div>
    </div>
  );
}

function Hero({ t, address, loading, by, counts }: {
  t: Token | undefined; address: string; loading: boolean; by: Map<string, BoardRow>; counts: HolderPoint[];
}) {
  const [copied, setCopied] = useState(false);
  const links = [
    { href: `https://www.geckoterminal.com/arc/tokens/${address}`, label: 'GeckoTerminal' },
    { href: `https://dexscreener.com/arc/${address}`, label: 'DexScreener' },
    { href: `https://arcexplorer.org/token/${address}`, label: 'Explorer' },
  ];
  function copy() {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  const all = counts.length ? counts[counts.length - 1]!.holders : null;
  const tracked = by.get('24h|all')?.holders ?? null;

  return (
    <Card glow className="rise overflow-hidden p-6 sm:p-8" style={{ '--i': 1 } as CSSProperties}>
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 items-center gap-5">
          <TokenLogo t={t} size={64} glow />
          <div className="min-w-0">
            <h1 className="text-grad flex flex-wrap items-baseline gap-x-3 text-[34px] font-semibold leading-tight tracking-[-0.04em]">
              {t?.symbol ?? (loading ? '…' : short(address))}
              <span className="text-lg font-normal tracking-tight text-ink-3" style={{ WebkitTextFillColor: 'currentColor' }}>{t?.name}</span>
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={copy} title="Copy address"
                className="mono inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink">
                {short(address)}
                <span className={`transition-colors ${copied ? 'text-up' : ''}`} aria-hidden>{copied ? '✓ copied' : '⧉'}</span>
              </button>
              {links.map(l => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
                  className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-all hover:border-accent/30 hover:text-ink">
                  {l.label} <span className="text-ink-3" aria-hidden>↗</span>
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs text-ink-3">Price</div>
          <div className="num mt-1 text-[34px] font-semibold leading-none tracking-[-0.05em]">{price(t?.price_usd)}</div>
          <div className="mt-2"><Chip v={t?.change_24h}>{pct(t?.change_24h, 2, true)} · 24h</Chip></div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.05] sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1">
        <HeroStat k="Market cap" v={usd(t?.mcap_usd)} />
        <HeroStat k="Liquidity" v={usd(t?.liquidity_usd)} />
        <HeroStat k="Pair age" v={age(t?.pair_created_at)} />
        <HeroStat k="Tracked holders" v={tracked == null ? '—' : String(tracked)} hint="Tracked wallets holding this token now" />
        <HeroStat k="All holders" v={all == null ? '—' : all.toLocaleString('en-US')} hint="Total on-chain holders, recorded every 4 hours. The line shows the last 30 days."
          extra={<Spark values={counts.map(c => c.holders)} w={96} h={30} />} />
      </div>
    </Card>
  );
}

function HeroStat({ k, v, hint, extra }: { k: string; v: string; hint?: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-2 bg-surface/95 px-4 py-4">
      <div>
        <div className="flex items-center gap-1 text-[11px] text-ink-3">{k}{hint && <Hint text={hint} />}</div>
        <div className="num mt-1.5 text-lg font-semibold tracking-[-0.04em]">{v}</div>
      </div>
      {extra}
    </div>
  );
}

function WindowCards({ r, win, loading }: { r: BoardRow | undefined; win: WinKey; loading: boolean }) {
  const vol = r ? r.inflow + r.outflow : 0;
  const share = vol ? r!.inflow / vol : null;
  const mix = r?.holders_cat ?? { smart: 0, whale: 0, fomo: 0 };
  const hw = HOLDER_WINDOWS.has(win);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="rise p-6" style={{ '--i': 3 } as CSSProperties}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
          Buy pressure <Hint text="Share of tracked-wallet USDC volume in this token that went into buying" />
        </div>
        <div className="relative mx-auto mt-3 max-w-[220px]">
          <Gauge share={loading ? null : share} size={220} />
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="num text-3xl font-semibold leading-none tracking-[-0.05em]">
              {share == null ? '—' : <Count v={share * 100} fmt={n => `${Math.round(n)}%`} />}
            </div>
            <div className="mt-1 text-[11px] text-ink-3">buying</div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 text-center">
          <Mini k="Inflow" v={r ? <Count v={r.inflow} fmt={n => usd(n)} /> : '—'} cls="text-up" />
          <Mini k="Net" v={r ? <Count v={r.net} fmt={n => usd(n, true)} /> : '—'} cls={tone(r?.net)} />
          <Mini k="Outflow" v={r ? <Count v={r.outflow} fmt={n => usd(n)} /> : '—'} cls="text-down" />
        </div>
      </Card>

      <Card className="rise flex flex-col p-6" style={{ '--i': 4 } as CSSProperties}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
          Wallets trading <Hint text="Distinct tracked wallets that bought or sold. A wallet can do both." />
        </div>
        <div className="num mt-3 text-[44px] font-semibold leading-none tracking-[-0.05em]">
          {r ? <Count v={r.buyers + r.sellers} fmt={n => String(Math.round(n))} /> : '—'}
        </div>
        <div className="mt-6 space-y-2">
          <SplitBar a={r?.buyers ?? 0} b={r?.sellers ?? 0} h="h-2.5" label="Buyers vs sellers" />
          <div className="num flex justify-between text-xs">
            <span className="text-up">{r?.buyers ?? 0} buying</span>
            <span className="text-down">{r?.sellers ?? 0} selling</span>
          </div>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3 pt-6 text-xs">
          <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="text-ink-3">Trades</div>
            <div className="num mt-1 text-base font-semibold">{r?.trades ?? '—'}</div>
          </div>
          <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-1 text-ink-3">Top trade <Hint text="Share of volume from the single largest trade (3+ trades)" /></div>
            <div className={`num mt-1 text-base font-semibold ${r?.top_share != null && r.top_share >= 0.6 ? 'text-whale' : ''}`}>
              {r?.top_share == null ? '—' : pct(r.top_share * 100, 0)}
            </div>
          </div>
        </div>
      </Card>

      <Card className="rise p-6" style={{ '--i': 5 } as CSSProperties}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
          Who holds it <Hint text="Tracked wallets holding this token now, by category" />
        </div>
        <div className="mt-4 flex items-center gap-6">
          <Donut counts={mix} size={132}>
            <div className="num text-3xl font-semibold leading-none tracking-[-0.05em]">{r?.holders ?? '—'}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-3">wallets</div>
          </Donut>
          <ul className="flex-1 space-y-3 text-[13px]">
            {CAT_LIST.map(c => {
              const total = mix.smart + mix.whale + mix.fomo;
              return (
                <li key={c}>
                  <div className="flex items-center gap-2"><CatDot c={c} /><span className="flex-1 text-ink-2">{CAT_LABEL[c]}</span><span className="num font-semibold">{mix[c]}</span></div>
                  <div className="mt-1.5 pl-4"><div className="h-1 rounded-full bg-white/[0.05]">
                    <div className="grow h-full rounded-full" style={{ width: `${total ? (mix[c] / total) * 100 : 0}%`, background: `var(--color-${c})` }} />
                  </div></div>
                </li>
              );
            })}
          </ul>
        </div>
        {hw && r && <div className="mt-5 flex items-center gap-2 text-xs text-ink-3"><Delta v={r.holders_delta} /> tracked holders in {labelOf(win)}</div>}
      </Card>
    </div>
  );
}

function Mini({ k, v, cls }: { k: string; v: React.ReactNode; cls: string }) {
  return (
    <div className="[&:not(:first-child)]:border-l [&:not(:first-child)]:border-white/[0.05]">
      <div className="text-[11px] text-ink-3">{k}</div>
      <div className={`num mt-1 text-[15px] font-semibold tracking-[-0.03em] ${cls}`}>{v}</div>
    </div>
  );
}

function Ladder({ by, counts, win, onWin, loading, error }: {
  by: Map<string, BoardRow>; counts: HolderPoint[]; win: WinKey; onWin: (w: WinKey) => void; loading: boolean; error: string | null;
}) {
  const [cat, setCat] = useState<CatAll>('all');

  function totalDelta(secs: number): number | null {
    if (counts.length < 2) return null;
    const last = counts[counts.length - 1]!;
    const since = Date.parse(last.ts) - secs * 1000;
    let base: HolderPoint | undefined;
    for (const p of counts) { if (Date.parse(p.ts) <= since) base = p; else break; }
    return base ? last.holders - base.holders : null;
  }
  const maxNet = Math.max(0, ...WINDOWS.map(w => Math.abs(by.get(`${w.key}|${cat}`)?.net ?? 0)));

  return (
    <Panel className="rise" style={{ '--i': 6 } as CSSProperties} title="Every window at a glance"
      sub="Short windows show what is happening now, long ones show the trend. Click a row to switch the window."
      right={<Seg<CatAll> label="Category" size="sm" value={cat} onChange={setCat} options={CATS} />}>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-white/[0.05] bg-white/[0.015]">
              <th className={th}>Window</th>
              <th className={`${th} min-w-56 text-right`}>Net flow</th>
              <th className={`${th} min-w-40`}>
                <span className="flex justify-between gap-3"><span>Inflow</span><span>Outflow</span></span>
              </th>
              <th className={`${th} min-w-36`}>
                <span className="flex justify-between gap-3"><span>Buyers</span><span>Sellers</span></span>
              </th>
              <th className={`${th} text-right`}>Trades</th>
              <th className={`${th} text-right`} title="Tracked holders now, and the change over the window">Tracked holders</th>
              {cat === 'all' && CAT_LIST.map(c => (
                <th key={c} className={`${th} text-right`}><span className="inline-flex items-center gap-1.5"><CatDot c={c} size="size-1.5" />{CAT_LABEL[c]} Δ</span></th>
              ))}
              <th className={`${th} text-right`} title="Change in the token's total on-chain holder count (recorded every 4h)">All holders Δ</th>
            </tr>
          </thead>
          <tbody>
            {WINDOWS.map((w, i) => {
              const r = by.get(`${w.key}|${cat}`);
              const hw = HOLDER_WINDOWS.has(w.key);
              const tot = hw ? totalDelta(w.secs) : null;
              const sel = w.key === win;
              return (
                <tr key={w.key} onClick={() => onWin(w.key)} tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onWin(w.key); }}
                  className={`rise cursor-pointer border-b border-white/[0.04] outline-none transition-colors duration-200 last:border-0 focus-visible:bg-white/[0.03] ${
                    sel ? 'bg-accent/[0.05]' : 'hover:bg-white/[0.025]'}`}
                  style={{ '--i': i } as CSSProperties}>
                  <td className={`${td} relative`}>
                    {sel && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-accent to-accent-2 shadow-[0_0_12px_var(--color-accent)]" />}
                    <span className={`num inline-grid min-w-10 place-items-center rounded-lg px-2 py-1 text-xs font-semibold transition-colors ${
                      sel ? 'bg-accent/15 text-accent' : 'bg-white/[0.04] text-ink-2'}`}>{w.label}</span>
                  </td>
                  <td className={td}>
                    <div className={`num text-right text-[15px] font-semibold ${tone(r?.net)}`}>{r ? usd(r.net, true) : '—'}</div>
                    {r && <div className="mt-2"><NetBar v={r.net} max={maxNet} i={i} /></div>}
                  </td>
                  <td className={td}>
                    {r ? <>
                      <div className="num flex justify-between gap-3 text-[13px]"><span className="text-up">{usd(r.inflow)}</span><span className="text-down">{usd(r.outflow)}</span></div>
                      <div className="mt-2"><SplitBar a={r.inflow} b={r.outflow} i={i} /></div>
                    </> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className={td}>
                    {r ? <>
                      <div className="num flex justify-between gap-3 text-[13px]"><span className="text-up">{r.buyers}</span><span className="text-down">{r.sellers}</span></div>
                      <div className="mt-2"><SplitBar a={r.buyers} b={r.sellers} i={i} /></div>
                    </> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className={`${td} num text-right text-[13px] text-ink-2`}>{r?.trades ?? '—'}</td>
                  <td className={`${td} text-right`}>
                    {r ? <span className="inline-flex items-center gap-2"><span className="num text-[13px] font-semibold">{r.holders}</span>{hw && <Delta v={r.holders_delta} />}</span> : '—'}
                  </td>
                  {cat === 'all' && CAT_LIST.map(c => {
                    const x = by.get(`${w.key}|${c}`);
                    return <td key={c} className={`${td} text-right`}>{hw && x ? <Delta v={x.holders_delta} /> : <span className="text-ink-3">—</span>}</td>;
                  })}
                  <td className={`${td} text-right`}>{tot == null ? <span className="text-ink-3">—</span> : <Delta v={tot} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Status loading={loading} error={error} />
      <p className="border-t border-white/[0.05] px-5 py-3 text-xs text-ink-3">
        Holder change shows on 4h · 12h · 24h · 1w · 1M. “All holders Δ” counts every on-chain holder, not only tracked wallets.
      </p>
    </Panel>
  );
}

function Trades({ address, win, t }: { address: string; win: WinKey; t: Token | undefined }) {
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
  const maxUsd = Math.max(0, ...(res.data?.rows ?? []).map(r => r.usd ?? 0));

  return (
    <Panel className="rise flex flex-col" style={{ '--i': 7 } as CSSProperties}
      title={<span className="flex items-center gap-2">Trades <span className="num rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{res.data?.count ?? 0}</span></span>}
      sub={`Tracked-wallet trades in the last ${labelOf(win)}, newest first.`}>
      <div className="scroll-thin max-h-[620px] flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
            <tr className="border-y border-white/[0.05]">
              <th className={th}>Time</th>
              <th className={th}>Wallet</th>
              <th className={th}>Side</th>
              <th className={`${th} text-right`}>{t?.symbol ?? 'Amount'}</th>
              <th className={`${th} min-w-32 text-right`}>USD</th>
            </tr>
          </thead>
          <tbody>
            {res.data?.rows.map((r, i) => (
              <tr key={r.id} className={`rise border-b border-white/[0.04] transition-colors hover:bg-white/[0.025] ${r.below_floor ? 'opacity-45' : ''}`}
                style={{ '--i': Math.min(i, 12) } as CSSProperties} title={r.below_floor ? 'Under $25: not counted as flow' : undefined}>
                <td className={td}>
                  <div className="text-[13px] text-ink-2">{ago(r.ts)}</div>
                  <div className="num text-[10.5px] text-ink-3">{dateTime(r.ts)}</div>
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <CatTag c={r.category} />
                    <span className="max-w-28 truncate text-[13px] text-ink-2">{wallets.data?.get(r.wallet_id)?.label ?? ''}</span>
                  </div>
                </td>
                <td className={td}>
                  <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold ${r.side === 'buy' ? 'bg-up/10 text-up' : 'bg-down/10 text-down'}`}>
                    <svg viewBox="0 0 10 10" className={`size-2.5 ${r.side === 'buy' ? '' : 'rotate-180'}`} aria-hidden>
                      <path d="M5 8.5v-7M2 4.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {r.side === 'buy' ? 'Buy' : 'Sell'}
                  </span>
                </td>
                <td className={`${td} num text-right text-[13px] text-ink-2`}>{qty(r.token_qty)}</td>
                <td className={td}>
                  <div className="num text-right text-[13px] font-medium">{usdExact(r.usd)}</div>
                  <div className="mt-1.5 flex justify-end"><div className="w-20">
                    <MagBar v={r.usd ?? 0} max={maxUsd} i={i} cls={r.side === 'buy' ? 'from-up/20 to-up/80' : 'from-down/20 to-down/80'} />
                  </div></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Status loading={res.loading && !res.data} error={res.error}
          empty={!res.loading && !res.data?.rows.length ? 'No tracked-wallet trades in this window.' : undefined} />
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.05] px-5 py-3 text-xs text-ink-3">
          <PageBtn disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Newer</PageBtn>
          <span className="num px-2">{page + 1} / {pages}</span>
          <PageBtn disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Older →</PageBtn>
        </div>
      )}
    </Panel>
  );
}

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 transition-colors hover:text-ink disabled:opacity-40">{children}</button>
  );
}

function Holders({ address, t }: { address: string; t: Token | undefined }) {
  const wallets = useAsync(walletMap, []);
  const res = useAsync(async () => ((await must(sb.from('positions').select('*').eq('token', address)
    .order('qty', { ascending: false }).limit(500))) ?? []) as Position[], [address]);
  const p = t?.price_usd ?? null;
  const maxVal = Math.max(0, ...(res.data ?? []).map(h => h.value_usd ?? 0));
  const mix = useMemo(() => {
    const m: Record<Cat, number> = { smart: 0, whale: 0, fomo: 0 };
    for (const h of res.data ?? []) { const c = wallets.data?.get(h.wallet_id)?.category as Cat | undefined; if (c) m[c]++; }
    return m;
  }, [res.data, wallets.data]);

  return (
    <Panel className="rise flex flex-col" style={{ '--i': 8 } as CSSProperties}
      title={<span className="flex items-center gap-2">Tracked holders <span className="num rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{res.data?.length ?? 0}</span></span>}
      sub="Largest positions first, with cost and unrealized PnL."
      right={res.data?.length ? (
        <div className="flex gap-3 text-xs text-ink-2">
          {CAT_LIST.filter(c => mix[c]).map(c => <span key={c} className="num inline-flex items-center gap-1.5"><CatDot c={c} />{mix[c]}</span>)}
        </div>
      ) : undefined}>
      <div className="scroll-thin max-h-[620px] flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
            <tr className="border-y border-white/[0.05]">
              <th className={`${th} w-10 pr-0 text-center`}>#</th>
              <th className={th}>Wallet</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} min-w-32 text-right`}>Value</th>
              <th className={`${th} text-right`} title="Average cost of the traded portion">Avg cost</th>
              <th className={`${th} text-right`} title="Unrealized PnL of the traded portion">PnL</th>
            </tr>
          </thead>
          <tbody>
            {res.data?.map((h, i) => {
              const w = wallets.data?.get(h.wallet_id);
              const avg = h.costed_qty > 0 ? h.cost_usd / h.costed_qty : null;
              const upnl = p != null && h.costed_qty > 0 ? h.costed_qty * p - h.cost_usd : null;
              const costlessShare = h.qty > 0 ? h.costless_qty / h.qty : 0;
              return (
                <tr key={h.wallet_id} className="rise border-b border-white/[0.04] transition-colors hover:bg-white/[0.025]" style={{ '--i': Math.min(i, 12) } as CSSProperties}>
                  <td className={`${td} num pr-0 text-center text-[11px] text-ink-3`}>{i + 1}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      {w && <CatTag c={w.category as Cat} />}
                      <span className="max-w-28 truncate text-[13px] text-ink-2">{w?.label ?? ''}</span>
                    </div>
                  </td>
                  <td className={`${td} text-right`}>
                    <div className="num text-[13px]">
                      {qty(h.qty)}
                      {costlessShare > 0.01 && (
                        <span className="ml-1 text-ink-3" title={`${qty(h.costless_qty)} arrived by transfer or before tracking: cost unknown`}>*</span>
                      )}
                    </div>
                    <div className="num text-[11px] text-ink-3">{t?.total_supply ? `${pct((h.qty / t.total_supply) * 100, 2)} supply` : ''}</div>
                  </td>
                  <td className={td}>
                    <div className="num text-right text-[13px] font-medium">{usd(h.value_usd)}</div>
                    <div className="mt-1.5 flex justify-end"><div className="w-24"><MagBar v={h.value_usd ?? 0} max={maxVal} i={i} /></div></div>
                  </td>
                  <td className={`${td} num text-right text-[13px] text-ink-2`}>{avg == null ? '—' : price(avg)}</td>
                  <td className={`${td} text-right`}>{upnl == null ? <span className="text-ink-3">—</span> : <Chip v={upnl}>{usd(upnl, true)}</Chip>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Status loading={res.loading && !res.data} error={res.error}
          empty={!res.loading && !res.data?.length ? 'No tracked wallet holds this token.' : undefined} />
      </div>
      <p className="border-t border-white/[0.05] px-5 py-3 text-xs text-ink-3">
        * Part of the balance arrived by transfer or before tracking; avg cost and PnL cover the traded part only.
      </p>
    </Panel>
  );
}
