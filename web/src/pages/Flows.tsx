import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sb } from '../lib/supabase';
import { fetchAll, tokenMap } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { Cat, Rotation } from '../lib/types';
import { WINDOWS, labelOf, winOf, type WinKey } from '../lib/windows';
import { dateTime, pct, usd } from '../lib/format';
import { CAT_COLOR, CAT_LABEL, CatDot, Chip, Count, Kpi, MagBar, PageHead, Panel, Seg, Spark, Status, TokenCell, td, th } from '../components/ui';

const RANGES = [
  { key: '1d', label: '24h', secs: 86_400 },
  { key: '1w', label: '1w', secs: 604_800 },
  { key: '1m', label: '1M', secs: 2_592_000 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];
const SERIES: Cat[] = ['smart', 'whale'];

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
  const rotRows = rot.data?.slice(0, 50) ?? [];
  const maxRot = rotRows[0]?.usd ?? 0;
  const rotTotal = rotRows.reduce((s, r) => s + r.usd, 0);
  const rangeLabel = RANGES.find(r => r.key === range)!.label;

  return (
    <div className="space-y-8">
      <PageHead eyebrow="USDC on the sidelines" title="Flows"
        desc="How much USDC smart and whale wallets are sitting on, and which tokens they rotate out of and into." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tile i={1} label="All tracked" now={total(last)} then={total(first)} values={pts.map(p => p.v.smart + p.v.whale)} range={rangeLabel} glow />
        {SERIES.map((c, i) => (
          <Tile key={c} i={i + 2} label={CAT_LABEL[c]} cat={c} now={last?.v[c] ?? null} then={first?.v[c] ?? null} values={pts.map(p => p.v[c])} range={rangeLabel} />
        ))}
      </div>

      <Panel className="rise" style={{ '--i': 4 } as CSSProperties} title="USDC balance by category"
        sub="Dry powder waiting in tracked wallets. Fomo wallets are left out: fomo.family only bridges USDC to Arc at the moment of a buy."
        right={<Seg<RangeKey> label="Range" size="sm" value={range} onChange={setRange} options={RANGES} />}>
        {pts.length >= 2 ? <LineChart key={range} pts={pts} /> : (
          <Status loading={series.loading} error={series.error}
            empty={!series.loading ? 'Not enough history yet. The series grows every 5 minutes.' : undefined} />
        )}
      </Panel>

      <Panel className="rise" style={{ '--i': 5 } as CSSProperties} title="Rotation"
        sub={rotRows.length ? <>Money that left one token and went straight into another · <span className="num text-ink-2">{usd(rotTotal)}</span> across {rotRows.length} pairs</> : 'Money that left one token and went straight into another.'}
        right={<Seg<WinKey> label="Window" size="sm" value={win} options={WINDOWS.map(w => ({ key: w.key, label: w.label }))}
          onChange={w => setParams(w === '24h' ? {} : { w }, { replace: true })} />}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-white/[0.05] bg-white/[0.015]">
                <th className={`${th} w-12 pr-0 text-center`}>#</th>
                <th className={th}>Sold</th>
                <th className={`${th} w-40`} />
                <th className={th}>Bought</th>
                <th className={`${th} min-w-52 text-right`}>USD rotated · {labelOf(win)}</th>
              </tr>
            </thead>
            <tbody>
              {rotRows.map((r, i) => (
                <tr key={`${r.from_token}>${r.to_token}`} className="rise group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]"
                  style={{ '--i': Math.min(i, 14) } as CSSProperties}>
                  <td className={`${td} num pr-0 text-center text-[11px] text-ink-3`}>{i + 1}</td>
                  <td className={td}><TokenCell t={tokens.data?.get(r.from_token)} address={r.from_token} /></td>
                  <td className={td}><Connector strength={maxRot ? r.usd / maxRot : 0} /></td>
                  <td className={td}><TokenCell t={tokens.data?.get(r.to_token)} address={r.to_token} /></td>
                  <td className={td}>
                    <div className="num text-right text-[15px] font-semibold">{usd(r.usd)}</div>
                    <div className="mt-2"><MagBar v={r.usd} max={maxRot} i={i} cls="from-accent-2/40 to-accent" /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Status loading={rot.loading && !rot.data} error={rot.error}
          empty={!rot.loading && !rotRows.length ? 'No rotations in this window.' : undefined} />
        <p className="border-t border-white/[0.05] px-5 py-3 text-xs text-ink-3">
          A wallet that sells token A and buys token B within the window counts as a rotation of the smaller of the two amounts.
        </p>
      </Panel>
    </div>
  );
}

function Connector({ strength }: { strength: number }) {
  const w = 1.5 + strength * 2.5;
  return (
    <svg viewBox="0 0 140 20" className="h-5 w-full min-w-28" aria-hidden>
      <defs>
        <linearGradient id="rot-g" gradientUnits="userSpaceOnUse" x1={4} x2={128} y1={0} y2={0}><stop offset="0" stopColor="var(--color-down)" /><stop offset="1" stopColor="var(--color-up)" /></linearGradient>
      </defs>
      <line x1={4} x2={128} y1={10} y2={10} stroke="rgb(255 255 255 / .06)" strokeWidth={w + 2} strokeLinecap="round" />
      <line x1={4} x2={128} y1={10} y2={10} stroke="url(#rot-g)" strokeWidth={w} strokeLinecap="round" className="flowing" style={{ opacity: 0.45 + strength * 0.55 }} />
      <path d="M128 5l7 5-7 5" fill="none" stroke="var(--color-up)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ label, now, then, cat, values, range, i, glow }: {
  label: string; now: number | null; then: number | null; cat?: Cat; values: number[]; range: string; i: number; glow?: boolean;
}) {
  const ch = now != null && then ? ((now - then) / then) * 100 : null;
  return (
    <Kpi label={label} dot={cat} i={i} glow={glow} value={now == null ? '—' : <Count v={now} fmt={n => usd(n)} />}>
      <div className="flex items-end justify-between gap-3">
        <div className="text-xs text-ink-3"><Chip v={ch}>{ch == null ? '—' : pct(ch, 1, true)}</Chip> <span className="ml-1">over {range}</span></div>
        <Spark values={values} w={96} h={32} color={cat ? CAT_COLOR[cat] : 'var(--color-accent)'} />
      </div>
    </Kpi>
  );
}

function LineChart({ pts }: { pts: Point[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  const H = 300, L = 60, R = 72, T = 16, B = 32;
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(300, el.clientWidth - 16)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, ticks, xTicks } = useMemo(() => {
    const t0 = pts[0]!.t, t1 = pts[pts.length - 1]!.t;
    const max = Math.max(1, ...pts.flatMap(p => SERIES.map(c => p.v[c]))) * 1.1;
    const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const step = niceStep(max / 4);
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    const n = W < 600 ? 3 : 5;
    const xTicks = Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
    return { x, y, ticks, xTicks };
  }, [pts, W]);

  const line = (c: Cat) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v[c]).toFixed(1)}`).join('');
  const area = (c: Cat) => `${line(c)}L${x(pts[pts.length - 1]!.t).toFixed(1)},${H - B}L${x(pts[0]!.t).toFixed(1)},${H - B}Z`;
  const hp = hover != null ? pts[hover] : undefined;
  const lastPt = pts[pts.length - 1]!;
  const fmtT = (t: number) => {
    const d = new Date(t);
    return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i]!.t) - px) < Math.abs(x(pts[best]!.t) - px)) best = i;
    setHover(best);
  }

  const labels = SERIES.map(c => ({ c, y: y(lastPt.v[c]) })).sort((a, b) => a.y - b.y);
  if (labels.length === 2 && labels[1]!.y - labels[0]!.y < 22) { labels[0]!.y -= 11; labels[1]!.y += 11; }

  return (
    <div ref={box} className="relative px-2 pb-4">
      <div className="mb-1 flex gap-5 px-3 text-xs text-ink-2">
        {SERIES.map(c => <span key={c} className="inline-flex items-center gap-1.5"><CatDot c={c} />{CAT_LABEL[c]}</span>)}
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full touch-none select-none" role="img"
        aria-label="USDC balance of tracked wallets by category" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          {SERIES.map(c => (
            <linearGradient key={c} id={`fill-${c}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={CAT_COLOR[c]} stopOpacity={0.16} />
              <stop offset="1" stopColor={CAT_COLOR[c]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map(v => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="rgb(255 255 255 / .05)" strokeDasharray="2 5" />
            <text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-3)" className="num">{usd(v)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--color-ink-3)">
            {fmtT(t)}
          </text>
        ))}
        {SERIES.map(c => <path key={`a-${c}`} d={area(c)} fill={`url(#fill-${c})`} className="fade-in" />)}
        {SERIES.map(c => (
          <path key={c} d={line(c)} pathLength={1} fill="none" stroke={CAT_COLOR[c]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="draw"
            style={{ filter: `drop-shadow(0 0 6px ${CAT_COLOR[c]})` }} />
        ))}
        {SERIES.map(c => (
          <g key={`e-${c}`} className="fade-in">
            <circle cx={x(lastPt.t)} cy={y(lastPt.v[c])} r={7} fill={CAT_COLOR[c]} opacity={0.2} className="ping" style={{ transformOrigin: `${x(lastPt.t)}px ${y(lastPt.v[c])}px` }} />
            <circle cx={x(lastPt.t)} cy={y(lastPt.v[c])} r={3.5} fill={CAT_COLOR[c]} stroke="var(--color-surface)" strokeWidth={2} />
          </g>
        ))}
        {labels.map(({ c, y: ly }) => (
          <g key={`l-${c}`} className="fade-in">
            <rect x={W - R + 8} y={ly - 10} width={R - 10} height={20} rx={6} fill="rgb(255 255 255 / .05)" stroke="rgb(255 255 255 / .08)" />
            <text x={W - R + 8 + (R - 10) / 2} y={ly + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink)" className="num">{usd(lastPt.v[c])}</text>
          </g>
        ))}
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={T} y2={H - B} stroke="rgb(255 255 255 / .2)" strokeDasharray="3 3" />
            {SERIES.map(c => (
              <circle key={c} cx={x(hp.t)} cy={y(hp.v[c])} r={4.5} fill={CAT_COLOR[c]} stroke="var(--color-surface)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-8 z-10 min-w-44 rounded-xl border border-white/10 bg-[#141823]/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur"
          style={{ left: Math.min(Math.max(8, x(hp.t) + 14), W - 200) }}>
          <div className="mb-1.5 text-ink-3">{dateTime(new Date(hp.t).toISOString())}</div>
          {SERIES.map(c => (
            <div key={c} className="flex items-center justify-between gap-6 py-0.5">
              <span className="inline-flex items-center gap-1.5 text-ink-2"><CatDot c={c} />{CAT_LABEL[c]}</span>
              <span className="num font-medium text-ink">{usd(hp.v[c])}</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-center justify-between gap-6 border-t border-white/10 pt-1.5">
            <span className="text-ink-3">Total</span>
            <span className="num font-semibold text-ink">{usd(hp.v.smart + hp.v.whale)}</span>
          </div>
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
