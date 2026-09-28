import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { fetchAll, must, tokensFor } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import { useAdmin } from '../lib/useAdmin';
import { useFlip } from '../lib/motion';
import type { BoardRow, Cat, CatAll, Token } from '../lib/types';
import { CATS, HOLDER_WINDOWS, WINDOWS, labelOf, winOf, type WinKey } from '../lib/windows';
import { pct, price, tone, usd } from '../lib/format';
import {
  CAT_LABEL, CAT_LIST, Card, CatBar, CatDot, Chip, Count, Delta, Donut, Gauge, Hint, MagBar, NetBar, PageHead, Panel, Seg, SplitBar,
  Status, TokenCell, TokenLogo, td, th,
} from '../components/ui';

const SORTS = [
  { key: 'net', label: 'Net' },
  { key: 'in', label: 'Inflow' },
  { key: 'out', label: 'Outflow' },
  { key: 'wallets', label: 'Wallets' },
  { key: 'holders', label: 'Holders' },
  { key: 'held', label: 'Held' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const sortVal: Record<SortKey, (r: BoardRow) => number> = {
  net: r => r.net,
  in: r => r.inflow,
  out: r => r.outflow,
  wallets: r => r.buyers + r.sellers,
  holders: r => r.holders,
  held: r => r.sm_usd ?? 0,
};

const PAGE = 25;

const holderCounts = (r: BoardRow): Record<Cat, number> => r.category === 'all'
  ? (r.holders_cat ?? { smart: 0, whale: 0, fomo: 0 })
  : { smart: 0, whale: 0, fomo: 0, [r.category]: r.holders };

export default function Board() {
  const [params, setParams] = useSearchParams();
  const win = winOf(params.get('w'));
  const cat = (CATS.find(c => c.key === params.get('c'))?.key ?? 'all') as CatAll;
  const sort = (SORTS.find(s => s.key === params.get('s'))?.key ?? 'net') as SortKey;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const { isAdmin } = useAdmin();

  const set = (k: string, v: string, def: string) => {
    const p = new URLSearchParams(params);
    if (v === def) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
    setOpen(null);
  };

  const res = useAsync(async () => {
    const data = await fetchAll<BoardRow>(() =>
      sb.from('board_rows').select('*').eq('win', win).eq('category', cat).order('token'));
    return { data, tokens: await tokensFor(data.map(r => r.token)) };
  }, [win, cat]);
  const rows = { data: res.data?.data, loading: res.loading, error: res.error };
  const tokens = { data: res.data?.tokens };

  const all = useMemo(() => (rows.data ?? []).filter(r => !removed.has(r.token)), [rows.data, removed]);

  const view = useMemo(() => {
    const t = tokens.data;
    const needle = q.trim().toLowerCase();
    return all
      .filter(r => !needle || (t?.get(r.token)?.symbol ?? '').toLowerCase().includes(needle)
        || (t?.get(r.token)?.name ?? '').toLowerCase().includes(needle) || r.token.includes(needle))
      .sort((a, b) => sortVal[sort](b) - sortVal[sort](a));
  }, [all, tokens.data, sort, q]);

  const shown = view.slice(0, limit);
  const maxNet = useMemo(() => Math.max(0, ...view.map(r => Math.abs(r.net))), [view]);
  const flip = useFlip<HTMLTableRowElement>(`${shown.map(r => r.token).join()}|${open}`);
  const holderWin = HOLDER_WINDOWS.has(win);
  const winLabel = labelOf(win);
  const loading = rows.loading && !rows.data;

  async function remove(address: string, symbol: string) {
    if (!window.confirm(`Blacklist ${symbol}? It disappears everywhere and its data stops being collected.`)) return;
    try {
      await must(sb.from('token_blacklist').insert({ address, reason: 'board' }));
      setRemoved(s => new Set(s).add(address));
    } catch (e) {
      window.alert(`Couldn't remove: ${e instanceof Error ? e.message : e}`);
    }
  }

  const sortTh = (k: SortKey, label: ReactNode, hint: string, cls = '') => (
    <th className={`${th} ${cls}`} aria-sort={k === sort ? 'descending' : 'none'}>
      <button onClick={() => set('s', k, 'net')} title={hint}
        className={`group/s inline-flex items-center gap-1 uppercase tracking-[0.09em] transition-colors ${k === sort ? 'text-ink' : 'hover:text-ink-2'}`}>
        {label}
        <svg viewBox="0 0 10 10" className={`size-2.5 transition-all duration-300 ${k === sort ? 'text-accent' : 'opacity-0 group-hover/s:opacity-40'}`} aria-hidden>
          <path d="M5 1.5v7M2 5.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </th>
  );
  const cols = isAdmin ? 11 : 10;

  return (
    <div className="space-y-8">
      <PageHead title="Flow Board"
        desc="Which tokens tracked wallets bought and sold on Arc, how many of them hold each one, and how much USDC moved."
        right={
          <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto sm:items-end">
            <Seg<WinKey> label="Time window" value={win} onChange={v => set('w', v, '24h')}
              options={WINDOWS.map(w => ({ key: w.key, label: w.label }))} />
            <Seg<CatAll> label="Wallet category" value={cat} onChange={v => set('c', v, 'all')} options={CATS} />
          </div>
        } />

      <div className="grid gap-4 lg:grid-cols-12">
        <Pulse rows={all} loading={loading} winLabel={winLabel} />
        <Leaders rows={all} tokens={tokens.data} loading={loading} holderWin={holderWin} winLabel={winLabel} />
      </div>

      <Panel className="rise" style={{ '--i': 3 } as CSSProperties}
        title={<span className="flex items-center gap-2">All tokens <span className="num rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-ink-2">{view.length}</span></span>}
        sub={<>Click a row for details. Sorted by <span className="text-ink-2">{SORTS.find(s => s.key === sort)!.label.toLowerCase()}</span>, {winLabel} window.</>}
        right={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="md:hidden"><Seg<SortKey> label="Sort" size="sm" value={sort} onChange={v => set('s', v, 'net')} options={SORTS} /></div>
            <label className="group/q relative w-full sm:w-64">
              <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3 transition-colors group-focus-within/q:text-accent" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" strokeLinecap="round" />
              </svg>
              <input value={q} onChange={e => { setQ(e.target.value); setOpen(null); }} placeholder="Search token or address" aria-label="Search token"
                className="w-full rounded-xl border border-white/[0.07] bg-white/[0.03] py-2 pl-9 pr-3 text-sm transition-all placeholder:text-ink-3 focus:border-accent/40 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-accent/10" />
            </label>
          </div>
        }>
        <div className="scroll-thin hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-white/[0.05] bg-white/[0.015]">
                <th className={`${th} w-12 pr-0 text-center`}>#</th>
                <th className={th}>Token</th>
                <th className={`${th} text-right`}>Price</th>
                {sortTh('net', 'Net flow', 'USDC bought minus USDC sold', 'min-w-48 text-right')}
                <th className={`${th} min-w-36`}>
                  <span className="flex items-center justify-between gap-3">
                    <button onClick={() => set('s', 'in', 'net')} className={`uppercase tracking-[0.09em] transition-colors ${sort === 'in' ? 'text-up' : 'hover:text-ink-2'}`}>Inflow</button>
                    <button onClick={() => set('s', 'out', 'net')} className={`uppercase tracking-[0.09em] transition-colors ${sort === 'out' ? 'text-down' : 'hover:text-ink-2'}`}>Outflow</button>
                  </span>
                </th>
                {sortTh('wallets', 'Buyers · Sellers', 'Distinct tracked wallets buying / selling', 'min-w-36')}
                {sortTh('holders', 'Holders', 'Tracked wallets holding now. The bar shows the Smart / Whale / Fomo mix.', 'min-w-36')}
                {sortTh('held', 'Held', 'USD value held by tracked wallets, and their share of supply', 'text-right')}
                <th className={`${th} text-right`}>MCap</th>
                <th className={`${th} w-10`} />
                {isAdmin && <th className={`${th} w-10`} />}
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const t = tokens.data?.get(r.token);
                const isOpen = open === r.token;
                const toggle = () => setOpen(o => (o === r.token ? null : r.token));
                return (
                  <Fragment key={r.token}>
                    <tr ref={flip(r.token)} tabIndex={0} aria-expanded={isOpen}
                      onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) toggle(); }}
                      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
                      className={`rise cursor-pointer border-b border-white/[0.04] outline-none transition-colors duration-200 focus-visible:bg-white/[0.03] ${
                        isOpen ? 'bg-white/[0.035]' : 'hover:bg-white/[0.025]'}`}
                      style={{ '--i': Math.min(i, 14) } as CSSProperties}>
                      <td className={`${td} pr-0 text-center`}><Rank n={i + 1} active={isOpen} /></td>
                      <td className={`${td} max-w-60`}><TokenCell t={t} address={r.token} /></td>
                      <td className={`${td} text-right`}>
                        <div className="num text-[13px]">{price(t?.price_usd)}</div>
                        <div className="mt-1"><Chip v={t?.change_24h}>{pct(t?.change_24h, 1, true)}</Chip></div>
                      </td>
                      <td className={td}>
                        <div className={`num text-right text-[15px] font-semibold ${tone(r.net)}`}>{usd(r.net, true)}</div>
                        <div className="mt-2"><NetBar v={r.net} max={maxNet} i={i} /></div>
                      </td>
                      <td className={td}>
                        <div className="num flex justify-between gap-3 text-[13px]">
                          <span className="text-up">{usd(r.inflow)}</span><span className="text-down">{usd(r.outflow)}</span>
                        </div>
                        <div className="mt-2"><SplitBar a={r.inflow} b={r.outflow} i={i} label={`Inflow ${usd(r.inflow)} · Outflow ${usd(r.outflow)}`} /></div>
                      </td>
                      <td className={td}>
                        <div className="num flex justify-between gap-3 text-[13px]">
                          <span className="text-up">{r.buyers}</span><span className="text-down">{r.sellers}</span>
                        </div>
                        <div className="mt-2"><SplitBar a={r.buyers} b={r.sellers} i={i} label={`${r.buyers} buyers · ${r.sellers} sellers`} /></div>
                      </td>
                      <td className={td}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="num text-[13px] font-semibold">{r.holders}</span>
                          {holderWin && <Delta v={r.holders_delta} />}
                        </div>
                        <div className="mt-2"><CatBar counts={holderCounts(r)} i={i} /></div>
                      </td>
                      <td className={`${td} text-right`}>
                        <div className="num text-[13px]">{usd(r.sm_usd)}</div>
                        <div className="num mt-1 text-[11px] text-ink-3">{pct(r.supply_pct, 2)} supply</div>
                      </td>
                      <td className={`${td} num text-right text-[13px] text-ink-2`}>{usd(t?.mcap_usd)}</td>
                      <td className={`${td} pl-0`}>
                        <button onClick={toggle} aria-label={isOpen ? 'Hide details' : 'Show details'}
                          className="grid size-7 place-items-center rounded-lg text-ink-3 transition-all hover:bg-white/[0.06] hover:text-ink">
                          <svg viewBox="0 0 12 12" className={`size-3 transition-transform duration-300 ${isOpen ? 'rotate-180 text-accent' : ''}`} aria-hidden>
                            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </td>
                      {isAdmin && (
                        <td className={`${td} pl-0`}>
                          <button onClick={() => remove(r.token, t?.symbol ?? r.token)} title="Blacklist token"
                            className="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-down/15 hover:text-down">✕</button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-white/[0.04] bg-white/[0.02]">
                        <td colSpan={cols} className="p-0">
                          <Detail r={r} t={t} win={win} holderWin={holderWin} winLabel={winLabel} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <ul className="md:hidden">
          {shown.map((r, i) => (
            <MobileRow key={r.token} r={r} i={i} t={tokens.data?.get(r.token)} maxNet={maxNet} holderWin={holderWin} win={win} />
          ))}
        </ul>

        {view.length > limit && (
          <div className="flex justify-center border-t border-white/[0.05] p-4">
            <button onClick={() => setLimit(l => l + PAGE * 2)}
              className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-medium text-ink-2 transition-all hover:border-accent/30 hover:text-ink">
              Show more <span className="num text-ink-3">· {view.length - limit} left</span>
            </button>
          </div>
        )}

        <Status loading={loading} error={rows.error} rows={8}
          empty={!rows.loading && !view.length ? (q ? 'No token matches your search.' : 'No tracked-wallet trades in this window.') : undefined} />
        <div className="h-2" />
      </Panel>

      <Legend />
    </div>
  );
}

function Rank({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={`num inline-grid size-6 place-items-center rounded-lg text-[11px] font-medium transition-colors ${
      active ? 'bg-accent/15 text-accent' : n <= 3 ? 'bg-gradient-to-br from-accent/20 to-accent-2/20 text-ink' : 'text-ink-3'}`}>
      {n}
    </span>
  );
}

function Pulse({ rows, loading, winLabel }: { rows: BoardRow[]; loading: boolean; winLabel: string }) {
  const s = useMemo(() => {
    const s = { in: 0, out: 0, pos: 0, neg: 0, held: 0 };
    for (const r of rows) {
      s.in += r.inflow; s.out += r.outflow; s.held += r.sm_usd ?? 0;
      if (r.net > 0) s.pos++; else if (r.net < 0) s.neg++;
    }
    return s;
  }, [rows]);
  const vol = s.in + s.out;
  const share = vol ? s.in / vol : null;
  const mood = share == null ? 'No trades yet' : share >= 0.6 ? 'Strong buying' : share >= 0.52 ? 'Leaning buy' : share > 0.48 ? 'Balanced' : share > 0.4 ? 'Leaning sell' : 'Strong selling';

  return (
    <Card glow className="rise flex flex-col p-6 lg:col-span-5" style={{ '--i': 1 } as CSSProperties}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
          Buy / sell balance · {winLabel}
          <Hint text="Share of tracked-wallet USDC volume that went into buying. Above 50% means more buying than selling." />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
          share == null ? 'bg-white/[0.05] text-ink-3' : share >= 0.52 ? 'bg-up/10 text-up' : share <= 0.48 ? 'bg-down/10 text-down' : 'bg-white/[0.06] text-ink-2'}`}>{mood}</span>
      </div>

      <div className="relative mx-auto mt-5 w-full max-w-[280px]">
        <Gauge share={loading ? null : share} size={280} />
        <div className="absolute inset-x-0 bottom-0 text-center">
          <div className="num text-[40px] font-semibold leading-none tracking-[-0.05em]">
            {loading || share == null ? '—' : <Count v={share * 100} fmt={n => `${Math.round(n)}%`} />}
          </div>
          <div className="mt-1.5 text-xs text-ink-3">of volume was buying</div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 rounded-2xl border border-white/[0.05] bg-black/25">
        <PulseStat label="Inflow" cls="text-up" v={s.in} loading={loading} />
        <PulseStat label="Net" cls={tone(s.in - s.out)} v={s.in - s.out} signed loading={loading} />
        <PulseStat label="Outflow" cls="text-down" v={s.out} loading={loading} />
      </div>

      <div className="mt-auto space-y-4 pt-6">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-ink-3">
              Breadth <Hint text="How many traded tokens saw more buying than selling, and the other way round" />
            </span>
            <span className="num text-ink-2"><span className="text-up">{s.pos} up</span> · <span className="text-down">{s.neg} down</span> · {rows.length} tokens</span>
          </div>
          <div className="mt-2"><SplitBar a={s.pos} b={s.neg} h="h-2" label={`${s.pos} tokens net bought, ${s.neg} net sold`} /></div>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-xs">
          <span className="text-ink-3">Tracked wallets currently hold</span>
          <span className="num text-sm font-semibold">{loading ? '—' : <Count v={s.held} fmt={n => usd(n)} />}</span>
        </div>
      </div>
    </Card>
  );
}

function PulseStat({ label, v, cls, signed, loading }: { label: string; v: number; cls: string; signed?: boolean; loading: boolean }) {
  return (
    <div className="px-3 py-3.5 text-center [&:not(:first-child)]:border-l [&:not(:first-child)]:border-white/[0.05]">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={`num mt-1 text-lg font-semibold tracking-[-0.04em] ${cls}`}>{loading ? '—' : <Count v={v} fmt={n => usd(n, signed)} />}</div>
    </div>
  );
}

const LEADER_TABS = [
  { key: 'bought', label: 'Bought' },
  { key: 'sold', label: 'Sold' },
  { key: 'held', label: 'Held' },
  { key: 'busy', label: 'Busiest' },
] as const;
type LeaderKey = (typeof LEADER_TABS)[number]['key'];

function Leaders({ rows, tokens, loading, holderWin, winLabel }: {
  rows: BoardRow[]; tokens: Map<string, Token> | undefined; loading: boolean; holderWin: boolean; winLabel: string;
}) {
  const [tab, setTab] = useState<LeaderKey>('bought');
  const list = useMemo(() => {
    const r = [...rows];
    if (tab === 'bought') return r.filter(x => x.net > 0).sort((a, b) => b.net - a.net).slice(0, 6);
    if (tab === 'sold') return r.filter(x => x.net < 0).sort((a, b) => a.net - b.net).slice(0, 6);
    if (tab === 'held') return r.filter(x => x.holders > 0).sort((a, b) => b.holders - a.holders).slice(0, 6);
    return r.filter(x => x.buyers + x.sellers > 0).sort((a, b) => b.buyers + b.sellers - (a.buyers + a.sellers)).slice(0, 6);
  }, [rows, tab]);

  const metric = (r: BoardRow) => (tab === 'bought' || tab === 'sold' ? Math.abs(r.net) : tab === 'held' ? r.holders : r.buyers + r.sellers);
  const max = list.length ? metric(list[0]!) : 0;
  const desc = {
    bought: `Highest net inflow · ${winLabel}`, sold: `Highest net outflow · ${winLabel}`,
    held: 'Most tracked wallets holding now', busy: `Most wallets trading · ${winLabel}`,
  }[tab];

  return (
    <Card className="rise flex flex-col p-6 lg:col-span-7" style={{ '--i': 2 } as CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Top tokens</h2>
          <p className="mt-1 text-xs text-ink-3">{desc}</p>
        </div>
        <Seg<LeaderKey> label="Leaderboard" size="sm" value={tab} onChange={setTab} options={LEADER_TABS} />
      </div>
      {loading ? <div className="-mx-5 mt-4"><Status loading rows={6} /></div> : (
        <ol key={tab} className="mt-4 flex-1 space-y-1">
          {!list.length && <li className="py-10 text-center text-sm text-ink-3">Nothing here in this window.</li>}
          {list.map((r, i) => {
            const t = tokens?.get(r.token);
            const val = tab === 'bought' || tab === 'sold'
              ? <span className={tone(r.net)}>{usd(r.net, true)}</span>
              : <>{metric(r)}<span className="ml-1 text-[11px] font-normal text-ink-3">wallets</span></>;
            const sub = tab === 'bought' ? `${r.buyers} buying` : tab === 'sold' ? `${r.sellers} selling`
              : tab === 'held' ? (holderWin && r.holders_delta ? <Delta v={r.holders_delta} /> : null)
              : <><span className="text-up">{r.buyers}</span> / <span className="text-down">{r.sellers}</span></>;
            const bar = tab === 'bought' ? 'from-up/25 to-up' : tab === 'sold' ? 'from-down/25 to-down' : 'from-accent-2/30 to-accent';
            return (
              <li key={r.token} className="rise" style={{ '--i': i } as CSSProperties}>
                <Link to={`/token/${r.token}`} className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
                  <span className="num w-4 text-center text-[11px] text-ink-3">{i + 1}</span>
                  <TokenLogo t={t} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold tracking-tight transition-colors group-hover:text-accent">{t?.symbol ?? r.token.slice(0, 8)}</span>
                      <span className="num text-sm font-semibold">{val}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="flex-1">
                        {tab === 'held'
                          ? <div style={{ width: `${Math.max(4, (metric(r) / max) * 100)}%` }}><CatBar counts={holderCounts(r)} h="h-1" i={i} /></div>
                          : <MagBar v={metric(r)} max={max} cls={bar} i={i} />}
                      </div>
                      <span className="num flex w-20 shrink-0 justify-end text-[11px] text-ink-3">{sub}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Detail({ r, t, win, holderWin, winLabel }: { r: BoardRow; t: Token | undefined; win: string; holderWin: boolean; winLabel: string }) {
  const counts = holderCounts(r);
  const maxWho = Math.max(0, ...r.who.map(w => w.usd ?? 0));
  const top = r.top_share == null ? null : r.top_share * 100;
  const barCls: Record<Cat, string> = { smart: 'from-smart/30 to-smart', whale: 'from-whale/30 to-whale', fomo: 'from-fomo/30 to-fomo' };
  return (
    <div className="open grid gap-8 px-6 py-6 lg:grid-cols-[1.4fr_1fr_1fr]">
      <div>
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-3">Biggest tracked wallets</h3>
        <ul className="mt-3 space-y-2.5">
          {r.who.slice(0, 6).map((w, i) => (
            <li key={w.id} className="flex items-center gap-3 text-[13px]">
              <CatDot c={w.c} />
              <span className="w-28 truncate text-ink-2">{w.l}</span>
              <div className="flex-1"><MagBar v={w.usd ?? 0} max={maxWho} i={i} cls={barCls[w.c]} /></div>
              <span className="num w-16 text-right">{usd(w.usd)}</span>
            </li>
          ))}
          {!r.who.length && <li className="text-sm text-ink-3">No wallet details.</li>}
        </ul>
      </div>
      <div className="flex items-center gap-5">
        <Donut counts={counts} size={112}>
          <div className="num text-2xl font-semibold leading-none tracking-[-0.04em]">{r.holders}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-ink-3">holders</div>
        </Donut>
        <ul className="space-y-2 text-[13px]">
          {CAT_LIST.map(c => (
            <li key={c} className="flex items-center gap-2"><CatDot c={c} /><span className="w-12 text-ink-3">{CAT_LABEL[c]}</span><span className="num font-medium">{counts[c]}</span></li>
          ))}
          {holderWin && <li className="flex items-center gap-1.5 pt-1 text-xs text-ink-3"><Delta v={r.holders_delta} /> in {winLabel}</li>}
        </ul>
      </div>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <Fact k="Liquidity" v={usd(t?.liquidity_usd)} />
          <Fact k="Trades" v={String(r.trades)} />
          <Fact k="Supply held" v={pct(r.supply_pct, 2)} />
          <Fact k="Top trade" v={top == null ? '—' : pct(top, 0)} warn={top != null && top >= 60}
            hint="Share of volume from the single largest trade. A high value means one trade drives the number." />
        </dl>
        <Link to={`/token/${r.token}?w=${win}`}
          className="group mt-auto inline-flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-xs font-semibold text-bg shadow-[0_8px_24px_-10px_var(--color-accent)] transition-all hover:brightness-110">
          Open {t?.symbol ?? 'token'}
          <span className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

function Fact({ k, v, warn, hint }: { k: string; v: string; warn?: boolean; hint?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-ink-3">{k}{hint && <Hint text={hint} />}</dt>
      <dd className={`num mt-0.5 font-medium ${warn ? 'text-whale' : ''}`}>{v}</dd>
    </div>
  );
}

function MobileRow({ r, i, t, maxNet, holderWin, win }: {
  r: BoardRow; i: number; t: Token | undefined; maxNet: number; holderWin: boolean; win: string;
}) {
  const nav = useNavigate();
  return (
    <li className="rise cursor-pointer border-t border-white/[0.05] px-5 py-4 active:bg-white/[0.03]" style={{ '--i': Math.min(i, 10) } as CSSProperties}
      onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) nav(`/token/${r.token}?w=${win}`); }}>
      <div className="flex items-center gap-3">
        <Rank n={i + 1} active={false} />
        <div className="min-w-0 flex-1"><TokenCell t={t} address={r.token} /></div>
        <div className="text-right">
          <div className={`num font-semibold ${tone(r.net)}`}>{usd(r.net, true)}</div>
          <div className="num mt-0.5 text-[11px] text-ink-3">{price(t?.price_usd)}</div>
        </div>
      </div>
      <div className="mt-3"><NetBar v={r.net} max={maxNet} i={i} /></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <MiniStat k="In / Out"><span className="text-up">{usd(r.inflow)}</span><span className="text-ink-3">/</span><span className="text-down">{usd(r.outflow)}</span></MiniStat>
        <MiniStat k="Buy / Sell"><span className="text-up">{r.buyers}</span><span className="text-ink-3">/</span><span className="text-down">{r.sellers}</span></MiniStat>
        <MiniStat k="Holders">{r.holders} {holderWin && <Delta v={r.holders_delta} />}</MiniStat>
      </div>
    </li>
  );
}

function MiniStat({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.03] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-3">{k}</div>
      <div className="num mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Legend() {
  return (
    <details className="card group px-5 py-4 text-xs text-ink-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-ink-2 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-wrap items-center gap-4">
          {CAT_LIST.map(c => <span key={c} className="inline-flex items-center gap-1.5"><CatDot c={c} />{CAT_LABEL[c]}</span>)}
        </span>
        <span className="ml-auto inline-flex items-center gap-2 font-medium">
          How to read this
          <svg viewBox="0 0 12 12" className="size-3 transition-transform duration-300 group-open:rotate-180" aria-hidden>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <dl className="open mt-4 grid gap-x-10 gap-y-3 border-t border-white/[0.05] pt-4 leading-relaxed sm:grid-cols-2">
        <Def t="Buy / sell balance">Share of USDC volume that went into buying. 50% means buying and selling were equal.</Def>
        <Def t="Net flow">USDC spent buying minus USDC received selling. The bar compares it with the biggest mover on the list.</Def>
        <Def t="Buyers · Sellers">Distinct tracked wallets that bought or sold. Green is buyers, red is sellers.</Def>
        <Def t="Holders">Tracked wallets holding the token now. The colored bar is the Smart / Whale / Fomo mix. Change shows on 4h · 12h · 24h · 1w · 1M.</Def>
        <Def t="Held">USD value held by tracked wallets and their share of the total supply.</Def>
        <Def t="Floor">Trades under $25 are not counted as flow but still change holdings.</Def>
      </dl>
    </details>
  );
}

function Def({ t, children }: { t: string; children: ReactNode }) {
  return <div><dt className="inline font-medium text-ink-2">{t}: </dt><dd className="inline">{children}</dd></div>;
}
