import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Cat, Token } from '../lib/types';
import { age } from '../lib/format';
import { spot, useCountUp } from '../lib/motion';

export const CAT_LABEL: Record<Cat, string> = { smart: 'Smart', whale: 'Whale', fomo: 'Fomo' };
export const CAT_BG: Record<Cat, string> = { smart: 'bg-smart', whale: 'bg-whale', fomo: 'bg-fomo' };
export const CAT_COLOR: Record<Cat, string> = { smart: 'var(--color-smart)', whale: 'var(--color-whale)', fomo: 'var(--color-fomo)' };
export const CAT_LIST: readonly Cat[] = ['smart', 'whale', 'fomo'];

export function Seg<K extends string>({ value, options, onChange, label, size = 'md' }: {
  value: K; options: readonly { key: K; label: string }[]; onChange: (k: K) => void; label: string; size?: 'sm' | 'md';
}) {
  const box = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<{ l: number; w: number } | null>(null);
  const idx = options.findIndex(o => o.key === value);

  useLayoutEffect(() => {
    const measure = () => { const b = btns.current[idx]; if (b) setInd({ l: b.offsetLeft, w: b.offsetWidth }); };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [idx, options.length]);

  return (
    <div ref={box} role="radiogroup" aria-label={label}
      className="scroll-thin relative inline-flex max-w-full overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.025] p-1">
      {ind && (
        <span aria-hidden className="absolute inset-y-1 rounded-lg bg-white/[0.08] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_4px_12px_-4px_rgb(0_0_0/0.6)] transition-all duration-300 ease-[var(--ease-out-soft)]"
          style={{ left: ind.l, width: ind.w }} />
      )}
      {options.map((o, i) => (
        <button key={o.key} ref={el => { btns.current[i] = el; }} role="radio" aria-checked={o.key === value} onClick={() => onChange(o.key)}
          className={`relative shrink-0 rounded-lg font-medium transition-colors duration-200 ${size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${
            o.key === value ? 'text-ink' : 'text-ink-3 hover:text-ink-2'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CatDot({ c, size = 'size-2' }: { c: Cat; size?: string }) {
  return <span className={`inline-block ${size} shrink-0 rounded-full ${CAT_BG[c]}`} style={{ boxShadow: `0 0 8px ${CAT_COLOR[c]}` }} aria-hidden />;
}

export function CatTag({ c }: { c: Cat }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-ink-2">
      <CatDot c={c} size="size-1.5" />{CAT_LABEL[c]}
    </span>
  );
}

export function CatBar({ counts, h = 'h-1.5', i = 0 }: { counts: Record<Cat, number>; h?: string; i?: number }) {
  const total = counts.smart + counts.whale + counts.fomo;
  if (!total) return <div className={`${h} w-full rounded-full bg-white/[0.05]`} />;
  const title = CAT_LIST.map(c => `${CAT_LABEL[c]} ${counts[c]}`).join(' · ');
  return (
    <div className={`grow flex ${h} w-full gap-[2px]`} style={{ '--i': i } as CSSProperties} title={title} aria-label={title} role="img">
      {CAT_LIST.filter(c => counts[c] > 0).map(c => (
        <div key={c} className={`${CAT_BG[c]} h-full rounded-full`} style={{ flexGrow: counts[c] }} />
      ))}
    </div>
  );
}

export function SplitBar({ a, b, h = 'h-1.5', label, i = 0 }: { a: number; b: number; h?: string; label?: string; i?: number }) {
  const total = a + b;
  if (!total) return <div className={`${h} w-full rounded-full bg-white/[0.05]`} />;
  return (
    <div className={`grow flex ${h} w-full gap-[2px]`} style={{ '--i': i } as CSSProperties} role="img" aria-label={label} title={label}>
      {a > 0 && <div className="h-full rounded-full bg-gradient-to-r from-up/60 to-up" style={{ width: `${(a / total) * 100}%` }} />}
      {b > 0 && <div className="h-full flex-1 rounded-full bg-gradient-to-r from-down to-down/60" />}
    </div>
  );
}

export function NetBar({ v, max, i = 0 }: { v: number; max: number; i?: number }) {
  const w = max > 0 ? Math.min(50, (Math.abs(v) / max) * 50) : 0;
  const pos = v >= 0;
  return (
    <div className="relative h-1.5 w-full rounded-full bg-white/[0.05]" aria-hidden>
      <div className="absolute -inset-y-1 left-1/2 w-px bg-white/15" />
      {w > 0 && (
        <div className={`grow absolute inset-y-0 rounded-full ${pos ? 'bg-gradient-to-r from-up/50 to-up' : 'bg-gradient-to-l from-down/50 to-down'}`}
          style={{
            ...(pos ? { left: '50%' } : { right: '50%' }), width: `${Math.max(1.5, w)}%`,
            boxShadow: `0 0 10px ${pos ? 'rgb(52 211 153 / .35)' : 'rgb(251 111 132 / .35)'}`,
            ...{ '--origin': pos ? 'left' : 'right', '--i': i },
          } as CSSProperties} />
      )}
    </div>
  );
}

export function MagBar({ v, max, cls = 'from-accent/40 to-accent', i = 0 }: { v: number; max: number; cls?: string; i?: number }) {
  const w = max > 0 ? Math.max(2, Math.min(100, (v / max) * 100)) : 0;
  return (
    <div className="h-1 w-full rounded-full bg-white/[0.05]" aria-hidden>
      <div className={`grow h-full rounded-full bg-gradient-to-r ${cls}`} style={{ width: `${w}%`, '--i': i } as CSSProperties} />
    </div>
  );
}

export function Gauge({ share, size = 220 }: { share: number | null; size?: number }) {
  const p = useCountUp(share == null ? 50 : share * 100);
  const gap = 1.5;
  const r = 80, cx = 100, cy = 92;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const ang = Math.PI * (1 - p / 100);
  const nx = cx + r * Math.cos(ang), ny = cy - r * Math.sin(ang);
  return (
    <svg viewBox="0 0 200 104" width={size} className="max-w-full overflow-visible" role="img"
      aria-label={share == null ? 'No volume' : `${Math.round(share * 100)}% of volume was buying`}>
      <defs>
        <linearGradient id="g-up" x1="0" x2="1"><stop offset="0" stopColor="var(--color-up)" stopOpacity=".45" /><stop offset="1" stopColor="var(--color-up)" /></linearGradient>
        <linearGradient id="g-down" x1="0" x2="1"><stop offset="0" stopColor="var(--color-down)" /><stop offset="1" stopColor="var(--color-down)" stopOpacity=".45" /></linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="rgb(255 255 255 / .05)" strokeWidth={12} strokeLinecap="round" />
      {share != null && <>
        {p - gap > 0 && <path d={arc} pathLength={100} fill="none" stroke="url(#g-up)" strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${p - gap} 200`} />}
        {100 - p - gap > 0 && <path d={arc} pathLength={100} fill="none" stroke="url(#g-down)" strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${100 - p - gap} 200`} strokeDashoffset={-(p + gap)} />}
        <circle cx={nx} cy={ny} r={7} fill="var(--color-bg)" stroke="#fff" strokeWidth={2.5} />
      </>}
    </svg>
  );
}

export function Donut({ counts, size = 120, children }: { counts: Record<Cat, number>; size?: number; children?: ReactNode }) {
  const total = counts.smart + counts.whale + counts.fomo;
  const t = useCountUp(1, 1100);
  const segs = CAT_LIST.filter(c => counts[c] > 0);
  const gap = segs.length > 1 ? 2.2 : 0;
  let acc = 0;
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" role="img"
        aria-label={CAT_LIST.map(c => `${CAT_LABEL[c]} ${counts[c]}`).join(', ')}>
        <circle cx={50} cy={50} r={42} fill="none" stroke="rgb(255 255 255 / .05)" strokeWidth={8} />
        {total > 0 && segs.map(c => {
          const len = (counts[c] / total) * 100 * t;
          const start = acc; acc += len;
          return <circle key={c} cx={50} cy={50} r={42} pathLength={100} fill="none" stroke={CAT_COLOR[c]} strokeWidth={8}
            strokeDasharray={`${Math.max(0.01, len - gap)} 200`} strokeDashoffset={-start} />;
        })}
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  );
}

let sparkId = 0;
export function Spark({ values, w = 120, h = 36, color = 'var(--color-accent)' }: { values: number[]; w?: number; h?: number; color?: string }) {
  const [id] = useState(() => `spark-${++sparkId}`);
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-visible" aria-hidden>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} className="fade-in" />
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" className="draw" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

export function TokenLogo({ t, size = 32, glow = false }: { t: Token | undefined; size?: number; glow?: boolean }) {
  const s = { width: size, height: size };
  const [broken, setBroken] = useState(false);
  const sym = (t?.symbol ?? '?').toUpperCase();
  const hue = [...sym].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const inner = t?.logo_url && !broken
    ? <img src={t.logo_url} alt="" style={s} className="relative shrink-0 rounded-full bg-raised ring-1 ring-white/10" loading="lazy"
        referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    : (
      <div style={{ ...s, background: `linear-gradient(140deg, hsl(${hue} 55% 32%), hsl(${(hue + 40) % 360} 50% 14%))`, color: `hsl(${hue} 85% 86%)`, fontSize: Math.max(9, size * 0.33) }}
        className="relative grid shrink-0 place-items-center rounded-full font-semibold tracking-tight ring-1 ring-white/10">
        {sym.slice(0, 2)}
      </div>
    );
  if (!glow) return inner;
  return (
    <div className="relative shrink-0">
      <div className="absolute inset-0 scale-[1.8] rounded-full opacity-40 blur-2xl" style={{ background: `hsl(${hue} 70% 45%)` }} aria-hidden />
      {inner}
    </div>
  );
}

export function TokenCell({ t, address, sub = true }: { t: Token | undefined; address: string; sub?: boolean }) {
  return (
    <Link to={`/token/${address}`} className="group/tok inline-flex min-w-0 max-w-full items-center gap-3 align-middle">
      <TokenLogo t={t} />
      <div className="min-w-0">
        <div className="truncate font-semibold tracking-tight text-ink transition-colors group-hover/tok:text-accent">{t?.symbol ?? short(address)}</div>
        {sub && (
          <div className="flex items-center gap-1.5 text-xs text-ink-3">
            <span className="truncate">{t?.name ?? ''}</span>
            {t?.pair_created_at && <span className="num shrink-0 rounded-md bg-white/[0.05] px-1 py-px text-[10px]">{age(t.pair_created_at)}</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Card({ children, className = '', glow = false, style }: { children: ReactNode; className?: string; glow?: boolean; style?: CSSProperties }) {
  return <div onPointerMove={spot} style={style} className={`card spot ${glow ? 'card-glow' : ''} ${className}`}>{children}</div>;
}

export function Panel({ title, sub, right, children, className = '', style }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
          </div>
          {right && <div className="min-w-0 max-w-full max-sm:w-full">{right}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, desc, right }: { title: ReactNode; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="rise flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <h1 className="text-grad pb-1 text-[32px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]">{title}</h1>
        {desc && <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{desc}</p>}
      </div>
      {right && <div className="min-w-0 max-w-full">{right}</div>}
    </div>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span tabIndex={0} data-tip={text} aria-label={text}
      className="tip inline-grid size-3.5 cursor-help place-items-center rounded-full border border-white/15 text-[9px] font-semibold text-ink-3 outline-none">?</span>
  );
}

export function Count({ v, fmt }: { v: number; fmt: (n: number) => string }) {
  return <>{fmt(useCountUp(v))}</>;
}

export function Kpi({ label, value, cls = 'text-ink', hint, children, dot, i = 0, glow, className = '' }: {
  label: string; value: ReactNode; cls?: string; hint?: string; children?: ReactNode; dot?: Cat; i?: number; glow?: boolean; className?: string;
}) {
  return (
    <Card glow={glow} className={`rise p-5 ${className}`} style={{ '--i': i } as CSSProperties}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        {dot && <CatDot c={dot} />}{label}
        {hint && <Hint text={hint} />}
      </div>
      <div className={`num mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.045em] ${cls}`}>{value}</div>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

export function Delta({ v }: { v: number | null | undefined }) {
  if (v == null || !Number.isFinite(v)) return <span className="text-ink-3">—</span>;
  const cls = v > 0 ? 'bg-up/10 text-up' : v < 0 ? 'bg-down/10 text-down' : 'bg-white/[0.05] text-ink-3';
  return <span className={`num inline-flex items-center rounded-md px-1.5 py-px text-[11px] font-medium ${cls}`}>{v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}</span>;
}

export function Chip({ v, children }: { v: number | null | undefined; children: ReactNode }) {
  const cls = v == null || v === 0 ? 'bg-white/[0.05] text-ink-3' : v > 0 ? 'bg-up/10 text-up' : 'bg-down/10 text-down';
  return <span className={`num inline-flex items-center gap-0.5 rounded-md px-1.5 py-px text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function Status({ loading, error, empty, rows = 5 }: { loading?: boolean; error?: string | null; empty?: string; rows?: number }) {
  if (error) return <div className="px-5 py-14 text-center text-sm text-down">Couldn't load data: {error}</div>;
  if (loading) {
    return (
      <div className="space-y-2 px-5 pb-5" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="shimmer h-11 rounded-xl" style={{ opacity: 1 - i * 0.15 }} />)}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-14 text-center text-sm text-ink-3">
        <GovooMark className="w-12 opacity-50" />
        {empty}
      </div>
    );
  }
  return null;
}

function Eyes({ g }: { g: string }) {
  return (
    <>
      <circle cx="168" cy="168" r="136.5" fill="none" stroke={`url(#${g})`} strokeWidth={63} />
      <circle cx="463" cy="168" r="136.5" fill="none" stroke={`url(#${g})`} strokeWidth={63} />
      <circle cx="207" cy="134" r="51" fill={`url(#${g})`} />
      <circle cx="502" cy="134" r="51" fill={`url(#${g})`} />
    </>
  );
}

function EyesGradient({ g }: { g: string }) {
  return (
    <linearGradient id={g} x1="0" y1="0" x2="631" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#5eead4" /><stop offset="1" stopColor="#818cf8" />
    </linearGradient>
  );
}

export function GovooMark({ className = '' }: { className?: string }) {
  const g = useId();
  return (
    <svg viewBox="0 0 631 336" className={className} aria-hidden>
      <defs><EyesGradient g={g} /></defs>
      <Eyes g={g} />
    </svg>
  );
}

export function GovooWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`items-baseline font-bold leading-none tracking-[-0.045em] ${className}`} role="img" aria-label="Govoo">
      <span aria-hidden>Gov</span>
      <GovooMark className="ml-[0.03em] h-[0.6em]" />
    </span>
  );
}

export const th = 'px-4 py-3 text-left text-[10.5px] font-medium uppercase tracking-[0.09em] text-ink-3 whitespace-nowrap';
export const td = 'px-4 py-3.5 whitespace-nowrap';
