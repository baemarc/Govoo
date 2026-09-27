export const WINDOWS = [
  { key: '15m', label: '15m', secs: 900 },
  { key: '1h', label: '1h', secs: 3600 },
  { key: '4h', label: '4h', secs: 14_400 },
  { key: '8h', label: '8h', secs: 28_800 },
  { key: '12h', label: '12h', secs: 43_200 },
  { key: '24h', label: '24h', secs: 86_400 },
  { key: '3d', label: '3d', secs: 259_200 },
  { key: '1w', label: '1w', secs: 604_800 },
  { key: '1m', label: '1M', secs: 2_592_000 },
] as const;
export type WinKey = (typeof WINDOWS)[number]['key'];

export const HOLDER_WINDOWS = new Set<string>(['4h', '12h', '24h', '1w', '1m']);

export const DEFAULT_WIN: WinKey = '24h';
export const winOf = (k: string | null): WinKey => WINDOWS.find(w => w.key === k)?.key ?? DEFAULT_WIN;
export const secsOf = (k: string) => WINDOWS.find(w => w.key === k)?.secs ?? 86_400;
export const labelOf = (k: string) => WINDOWS.find(w => w.key === k)?.label ?? k;

export const CATS = [
  { key: 'all', label: 'All' },
  { key: 'smart', label: 'Smart' },
  { key: 'whale', label: 'Whale' },
  { key: 'fomo', label: 'Fomo' },
] as const;
