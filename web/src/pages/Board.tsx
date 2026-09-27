import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { fetchAll, must, tokenMap } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import { useAdmin } from '../lib/useAdmin';
import type { BoardRow, Cat, CatAll } from '../lib/types';
import { CATS, HOLDER_WINDOWS, WINDOWS, winOf, type WinKey } from '../lib/windows';
import { pct, price, signedInt, tone, usd } from '../lib/format';
import { CatBar, CatDot, Panel, Seg, Status, TokenCell, td, th } from '../components/ui';

const SORTS = [
  { key: 'net', label: 'Net' },
  { key: 'in', label: 'Inflow' },
  { key: 'out', label: 'Outflow' },
  { key: 'wallets', label: 'Wallets' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const sortVal: Record<SortKey, (r: BoardRow) => number> = {
  net: r => r.net,
  in: r => r.inflow,
  out: r => r.outflow,
  wallets: r => r.buyers + r.sellers,
};

export default function Board() {
  const [params, setParams] = useSearchParams();
  const win = winOf(params.get('w'));
  const cat = (CATS.find(c => c.key === params.get('c'))?.key ?? 'all') as CatAll;
  const sort = (SORTS.find(s => s.key === params.get('s'))?.key ?? 'net') as SortKey;
  const [q, setQ] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const { isAdmin } = useAdmin();
  const nav = useNavigate();

  const set = (k: string, v: string, def: string) => {
    const p = new URLSearchParams(params);
    if (v === def) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  const rows = useAsync(() => fetchAll<BoardRow>(() =>
    sb.from('board_rows').select('*').eq('win', win).eq('category', cat).order('token')), [win, cat]);
  const tokens = useAsync(tokenMap, []);

  const view = useMemo(() => {
    const t = tokens.data;
    const needle = q.trim().toLowerCase();
    return (rows.data ?? [])
      .filter(r => !removed.has(r.token))
      .filter(r => !needle || (t?.get(r.token)?.symbol ?? '').toLowerCase().includes(needle)
        || (t?.get(r.token)?.name ?? '').toLowerCase().includes(needle) || r.token.includes(needle))
      .sort((a, b) => sortVal[sort](b) - sortVal[sort](a));
  }, [rows.data, tokens.data, sort, q, removed]);

  const totals = useMemo(() => view.reduce((a, r) => ({ in: a.in + r.inflow, out: a.out + r.outflow }), { in: 0, out: 0 }), [view]);
  const holderWin = HOLDER_WINDOWS.has(win);

  async function remove(address: string, symbol: string) {
    if (!window.confirm(`Blacklist ${symbol}? It disappears everywhere and its data stops being collected.`)) return;
    try {
      await must(sb.from('token_blacklist').insert({ address, reason: 'board' }));
      setRemoved(s => new Set(s).add(address));
    } catch (e) {
      window.alert(`Couldn't remove: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Flow Board</h1>
          <p className="mt-1 text-sm text-ink-3">
            Where tracked wallets moved USDC in the last {WINDOWS.find(w => w.key === win)!.label}.
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <Stat label="Inflow" value={usd(totals.in)} cls="text-up" />
          <Stat label="Outflow" value={usd(totals.out)} cls="text-down" />
          <Stat label="Net" value={usd(totals.in - totals.out, true)} cls={tone(totals.in - totals.out)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Seg<WinKey> label="Window" value={win} onChange={v => set('w', v, '24h')}
          options={WINDOWS.map(w => ({ key: w.key, label: w.label }))} />
        <Seg<CatAll> label="Category" value={cat} onChange={v => set('c', v, 'all')} options={CATS} />
        <Seg<SortKey> label="Sort" value={sort} onChange={v => set('s', v, 'net')} options={SORTS} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search token"
          className="ml-auto w-44 rounded-md border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-ink-3 focus:border-ink-3 focus:outline-none" />
      </div>

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={`${th} w-8 text-right`}>#</th>
                <th className={th}>Token</th>
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} text-right`}>24h</th>
                <th className={`${th} text-right`}>MCap</th>
                <th className={`${th} text-right`}>Liq</th>
                <th className={`${th} text-right`}>Inflow</th>
                <th className={`${th} text-right`}>Outflow</th>
                <th className={`${th} text-right`}>Net</th>
                <th className={`${th} text-right`} title="Distinct tracked wallets buying / selling">Buy / Sell</th>
                <th className={`${th} text-right`} title="Share of gross volume from the largest single trade (shown when 3+ trades)">Top tx</th>
                <th className={th} title="Tracked wallets holding now, change over the window">Holders</th>
                <th className={th}>Who</th>
                <th className={`${th} text-right`} title="USD held by tracked wallets">SM $</th>
                <th className={`${th} text-right`} title="Share of supply held by tracked wallets">Supply</th>
                {isAdmin && <th className={th} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {view.map((r, i) => {
                const t = tokens.data?.get(r.token);
                const counts: Record<Cat, number> = r.category === 'all'
                  ? (r.holders_cat ?? { smart: 0, whale: 0, fomo: 0 })
                  : { smart: 0, whale: 0, fomo: 0, [r.category]: r.holders };
                return (
                  <tr key={r.token} className="cursor-pointer hover:bg-raised/60"
                    onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) nav(`/token/${r.token}?w=${win}`); }}>
                    <td className={`${td} num text-right text-ink-3`}>{i + 1}</td>
                    <td className={`${td} max-w-56`}><TokenCell t={t} address={r.token} /></td>
                    <td className={`${td} num text-right`}>{price(t?.price_usd)}</td>
                    <td className={`${td} num text-right ${tone(t?.change_24h)}`}>{pct(t?.change_24h, 1, true)}</td>
                    <td className={`${td} num text-right text-ink-2`}>{usd(t?.mcap_usd)}</td>
                    <td className={`${td} num text-right text-ink-2`}>{usd(t?.liquidity_usd)}</td>
                    <td className={`${td} num text-right text-up`}>{usd(r.inflow)}</td>
                    <td className={`${td} num text-right text-down`}>{usd(r.outflow)}</td>
                    <td className={`${td} num text-right font-semibold ${tone(r.net)}`}>{usd(r.net, true)}</td>
                    <td className={`${td} num text-right`}>
                      <span className="text-up">{r.buyers}</span><span className="text-ink-3"> / </span><span className="text-down">{r.sellers}</span>
                    </td>
                    <td className={`${td} num text-right text-ink-2`}>{r.top_share == null ? '—' : pct(r.top_share * 100, 0)}</td>
                    <td className={`${td} w-32`}>
                      <div className="num flex items-baseline gap-1.5">
                        <span>{r.holders}</span>
                        <span className={`text-xs ${holderWin ? tone(r.holders_delta) : 'text-ink-3'}`}>
                          {holderWin ? signedInt(r.holders_delta) : '—'}
                        </span>
                      </div>
                      <div className="mt-1"><CatBar counts={counts} /></div>
                    </td>
                    <td className={`${td} max-w-64`}><Who who={r.who} /></td>
                    <td className={`${td} num text-right`}>{usd(r.sm_usd)}</td>
                    <td className={`${td} num text-right text-ink-2`}>{pct(r.supply_pct, 2)}</td>
                    {isAdmin && (
                      <td className={td}>
                        <button onClick={() => remove(r.token, t?.symbol ?? r.token)} title="Blacklist token"
                          className="rounded px-1.5 text-ink-3 hover:bg-down/15 hover:text-down">✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Status loading={rows.loading && !rows.data} error={rows.error ?? tokens.error}
          empty={!rows.loading && !view.length ? 'No tracked-wallet trades in this window.' : undefined} />
      </Panel>

      <Legend />
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="text-right">
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`num text-base font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Who({ who }: { who: BoardRow['who'] }) {
  if (!who.length) return <span className="text-ink-3">—</span>;
  const title = who.map(w => `${w.l} ${usd(w.usd)}`).join('\n');
  return (
    <div className="flex items-center gap-3 text-xs" title={title}>
      {who.slice(0, 2).map(w => (
        <span key={w.id} className="inline-flex min-w-0 items-center gap-1.5">
          <CatDot c={w.c} /><span className="max-w-28 truncate text-ink-2">{w.l}</span>
          <span className="num text-ink-3">{usd(w.usd)}</span>
        </span>
      ))}
      {who.length > 2 && <span className="text-ink-3">+{who.length - 2}</span>}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-ink-3">
      {(['smart', 'whale', 'fomo'] as const).map(c => (
        <span key={c} className="inline-flex items-center gap-1.5"><CatDot c={c} />{c[0]!.toUpperCase() + c.slice(1)}</span>
      ))}
      <span>Holder change shows on 4h · 12h · 24h · 1w · 1M windows. Trades under $25 are not counted as flow.</span>
    </div>
  );
}
