import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { fetchAll, tokenMap } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { Cat, Rotation } from '../lib/types';
import { WINDOWS, winOf, type WinKey } from '../lib/windows';
import { dateTime, pct, tone, usd } from '../lib/format';
import { CAT_LABEL, CatDot, Panel, Seg, Status, TokenCell, td, th } from '../components/ui';

const RANGES = [
  { key: '1d', label: '24h', secs: 86_400 },
  { key: '1w', label: '1w', secs: 604_800 },
  { key: '1m', label: '1M', secs: 2_592_000 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
const SERIES: Cat[] = ['smart', 'whale'];
const COLOR: Record<Cat, string> = { smart: 'var(--color-smart)', whale: 'var(--color-whale)', fomo: 'var(--color-fomo)' };

interface Point { t: number; v: Record<Cat, number> }

export default function Flows() {
  const [params, setParams] = useSearchParams();
  const win = winOf(params.get('w'));
  const [range, setRange] = useState<RangeKey>('1w');

  const series = useAsync(async () => {
    const secs = RANGES.find(r => r.key === range)!.secs;
    const rows = await fetchAll<{ ts: string; category: string; usd: number }>(() => sb.from('usdc_series')
      .select('ts, category, usd').neq('category', 'all')
      .gte('ts', new Date(Date.now() - secs * 1000).toISOString()).order('ts').order('category'));
    const by = new Map<number, Point>();
    for (const r of rows) {
      const t = Date.parse(r.ts);
      const p = by.get(t) ?? by.set(t, { t, v: { smart: 0, whale: 0, fomo: 0 } }).get(t)!;
      if (r.category in p.v) p.v[r.category as Cat] = r.usd;
    }
    return [...by.values()].sort((a, b) => a.t - b.t);
  }, [range]);

  const rot = useAsync(async () => fetchAll<Rotation>(() =>
    sb.from('rotations').select('*').eq('win', win).order('usd', { ascending: false }).order('from_token').order('to_token')), [win]);
  const tokens = useAsync(tokenMap, []);

  const pts = series.data ?? [];
  const last = pts[pts.length - 1];
  const first = pts.length >= 2 ? pts[0] : undefined;
  const total = (p: Point | undefined) => (p ? p.v.smart + p.v.whale : null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Flows</h1>
        <p className="mt-1 text-sm text-ink-3">USDC held by smart and whale wallets, and where tracked wallets rotated from one token into another. Fomo wallets are left out of the balance: fomo.family keeps one balance across chains and only moves USDC to Arc at the moment of a buy.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tile label="All tracked" now={total(last)} then={total(first)} />
        {SERIES.map(c => <Tile key={c} label={CAT_LABEL[c]} cat={c} now={last?.v[c] ?? null} then={first?.v[c] ?? null} />)}
      </div>

      <Panel title="USDC balance by category"
        right={<Seg<RangeKey> label="Range" value={range} onChange={setRange} options={RANGES} />}>
        {pts.length >= 2 ? <LineChart pts={pts} /> : (
          <Status loading={series.loading} error={series.error}
            empty={!series.loading ? 'Not enough history yet. The series grows every 5 minutes.' : undefined} />
        )}
      </Panel>

      <Panel title="Rotation"
        right={<Seg<WinKey> label="Window" value={win} options={WINDOWS.map(w => ({ key: w.key, label: w.label }))}
          onChange={w => setParams(w === '24h' ? {} : { w }, { replace: true })} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={`${th} w-8 text-right`}>#</th>
                <th className={th}>Sold</th>
                <th className={th} />
                <th className={th}>Bought</th>
                <th className={`${th} text-right`}>USD rotated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rot.data?.slice(0, 50).map((r, i) => (
                <tr key={`${r.from_token}>${r.to_token}`} className="hover:bg-raised/60">
                  <td className={`${td} num text-right text-ink-3`}>{i + 1}</td>
                  <td className={td}><TokenCell t={tokens.data?.get(r.from_token)} address={r.from_token} /></td>
                  <td className={`${td} text-ink-3`}>→</td>
                  <td className={td}><TokenCell t={tokens.data?.get(r.to_token)} address={r.to_token} /></td>
                  <td className={`${td} num text-right font-semibold`}>{usd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Status loading={rot.loading && !rot.data} error={rot.error}
          empty={!rot.loading && !rot.data?.length ? 'No rotations in this window.' : undefined} />
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          A wallet that sells token A and buys token B within the window counts as a rotation of the smaller of the two amounts.
        </p>
      </Panel>
    </div>
  );
}

function Tile({ label, now, then, cat }: { label: string; now: number | null; then: number | null; cat?: Cat }) {
  const ch = now != null && then ? ((now - then) / then) * 100 : null;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-3">{cat && <CatDot c={cat} />}{label}</div>
      <div className="num mt-1 text-xl font-semibold">{usd(now)}</div>
      <div className={`num text-xs ${tone(ch)}`}>{ch == null ? '—' : pct(ch, 1, true)} <span className="text-ink-3">over range</span></div>
    </div>
  );
}

function LineChart({ pts }: { pts: Point[] }) {
  const W = 960, H = 280, L = 56, R = 16, T = 12, B = 28;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { x, y, ticks, xTicks } = useMemo(() => {
    const t0 = pts[0]!.t, t1 = pts[pts.length - 1]!.t;
    const max = Math.max(1, ...pts.flatMap(p => SERIES.map(c => p.v[c]))) * 1.08;
    const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const step = niceStep(max / 4);
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
    return { x, y, ticks, xTicks };
  }, [pts]);

  const path = (c: Cat) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v[c]).toFixed(1)}`).join('');
  const hp = hover != null ? pts[hover] : undefined;

  function onMove(e: React.PointerEvent) {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i]!.t) - px) < Math.abs(x(pts[best]!.t) - px)) best = i;
    setHover(best);
  }

  const lastPt = pts[pts.length - 1]!;
  return (
    <div className="relative px-2 pb-2 pt-3">
      <div className="mb-2 flex gap-4 px-2 text-xs text-ink-2">
        {SERIES.map(c => <span key={c} className="inline-flex items-center gap-1.5"><CatDot c={c} />{CAT_LABEL[c]}</span>)}
      </div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img"
        aria-label="USDC balance of tracked wallets by category" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)">{usd(v)}</text>
          </g>
        ))}
        {xTicks.map(t => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
            {new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
            {new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
        {SERIES.map(c => <path key={c} d={path(c)} fill="none" stroke={COLOR[c]} strokeWidth={2} strokeLinejoin="round" />)}
        {SERIES.map(c => (
          <text key={c} x={Math.min(x(lastPt.t) + 4, W - R)} y={y(lastPt.v[c]) - 6} textAnchor="end" fontSize={11} fill="var(--color-ink-2)">
            {usd(lastPt.v[c])}
          </text>
        ))}
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={T} y2={H - B} stroke="var(--color-ink-3)" strokeWidth={1} />
            {SERIES.map(c => (
              <circle key={c} cx={x(hp.t)} cy={y(hp.v[c])} r={4} fill={COLOR[c]} stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-10 rounded-md border border-line bg-raised px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(8px, calc(${(x(hp.t) / W) * 100}% + 12px), calc(100% - 180px))` }}>
          <div className="mb-1 text-ink-3">{dateTime(new Date(hp.t).toISOString())}</div>
          {SERIES.map(c => (
            <div key={c} className="flex items-center justify-between gap-6">
              <span className="inline-flex items-center gap-1.5 text-ink-2"><CatDot c={c} />{CAT_LABEL[c]}</span>
              <span className="num text-ink">{usd(hp.v[c])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
