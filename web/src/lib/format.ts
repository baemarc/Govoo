const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const compact1 = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

export function usd(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  const a = Math.abs(v);
  const body = a >= 1000 ? compact1.format(a) : a >= 1 ? a.toFixed(0) : a.toFixed(2);
  return `${sign}$${body}`;
}

export function usdExact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return '—';
  if (v >= 1) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  const m = /^0\.(0*)(\d{1,4})/.exec(v.toFixed(20));
  if (!m) return '$' + v.toPrecision(4);
  const zeros = m[1]!.length;
  if (zeros < 4) return '$' + Number(v.toPrecision(4)).toString();
  const sub = String(zeros).split('').map(d => SUB[Number(d)]).join('');
  return `$0.0${sub}${m[2]}`;
}

export function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 1000 ? compact.format(v) : v.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function pct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : '';
  const a = Math.abs(v);
  return `${sign}${a < 0.1 && a > 0 ? a.toFixed(2) : a.toFixed(digits)}%`;
}

export const signedInt = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

export function age(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  if (s < 86_400 * 60) return `${Math.round(s / 86_400)}d`;
  return `${Math.round(s / (86_400 * 30))}mo`;
}

export const ago = (iso: string | null | undefined) => (iso ? `${age(iso)} ago` : '—');

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const tone = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down';
