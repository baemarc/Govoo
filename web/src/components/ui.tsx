import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Cat, Token } from '../lib/types';
import { age } from '../lib/format';

export const CAT_LABEL: Record<Cat, string> = { smart: 'Smart', whale: 'Whale', fomo: 'Fomo' };
export const CAT_BG: Record<Cat, string> = { smart: 'bg-smart', whale: 'bg-whale', fomo: 'bg-fomo' };

export function Seg<K extends string>({ value, options, onChange, label }: {
  value: K; options: readonly { key: K; label: string }[]; onChange: (k: K) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {options.map(o => (
        <button key={o.key} role="radio" aria-checked={o.key === value} onClick={() => onChange(o.key)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            o.key === value ? 'bg-raised text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CatDot({ c }: { c: Cat }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${CAT_BG[c]}`} aria-hidden />;
}

export function CatTag({ c }: { c: Cat }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <CatDot c={c} />{CAT_LABEL[c]}
    </span>
  );
}

export function CatBar({ counts }: { counts: Record<Cat, number> }) {
  const total = counts.smart + counts.whale + counts.fomo;
  if (!total) return <div className="h-1.5 w-full rounded-full bg-line" />;
  const title = (['smart', 'whale', 'fomo'] as const).map(c => `${CAT_LABEL[c]} ${counts[c]}`).join(' · ');
  return (
    <div className="flex h-1.5 w-full gap-[2px]" title={title} aria-label={title} role="img">
      {(['smart', 'whale', 'fomo'] as const).filter(c => counts[c] > 0).map(c => (
        <div key={c} className={`${CAT_BG[c]} h-full rounded-full`} style={{ flexGrow: counts[c] }} />
      ))}
    </div>
  );
}

export function TokenLogo({ t, size = 24 }: { t: Token | undefined; size?: number }) {
  const s = { width: size, height: size };
  const [broken, setBroken] = useState(false);
  if (t?.logo_url && !broken) {
    return <img src={t.logo_url} alt="" style={s} className="shrink-0 rounded-full bg-raised" loading="lazy"
      referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <div style={s} className="grid shrink-0 place-items-center rounded-full bg-raised text-[10px] font-semibold text-ink-3">
      {(t?.symbol ?? '?').slice(0, 2).toUpperCase()}
    </div>
  );
}

export function TokenCell({ t, address }: { t: Token | undefined; address: string }) {
  return (
    <Link to={`/token/${address}`} className="flex min-w-0 items-center gap-2.5">
      <TokenLogo t={t} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink">{t?.symbol ?? short(address)}</div>
        <div className="truncate text-xs text-ink-3">{t?.name ?? ''}{t?.pair_created_at ? ` · ${age(t.pair_created_at)}` : ''}</div>
      </div>
    </Link>
  );
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function Panel({ title, right, children, className = '' }: {
  title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Status({ loading, error, empty }: { loading?: boolean; error?: string | null; empty?: string }) {
  if (error) return <div className="px-4 py-10 text-center text-sm text-down">Couldn't load data: {error}</div>;
  if (loading) return <div className="px-4 py-10 text-center text-sm text-ink-3">Loading…</div>;
  if (empty) return <div className="px-4 py-10 text-center text-sm text-ink-3">{empty}</div>;
  return null;
}

export const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-3 whitespace-nowrap';
export const td = 'px-3 py-2 whitespace-nowrap';
