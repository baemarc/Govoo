import { USDC, USDC_MIRROR } from '../chain.js';

export const RESERVED = new Set([
  'USDC', 'USDT', 'EURC', 'USYC', 'USD', 'DAI', 'PYUSD', 'FDUSD',
  'ETH', 'WETH', 'BTC', 'WBTC', 'CBBTC', 'SOL', 'ARC',
]);

const CANONICAL = new Set([USDC, USDC_MIRROR]);

const clean = (s: string | null | undefined, max: number) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);

export function displaySymbol(address: string, symbol: string | null | undefined, name: string | null | undefined): string {
  const addr = address.toLowerCase();
  const sym = clean(symbol, 20);
  if (sym && (!RESERVED.has(sym) || CANONICAL.has(addr))) return (symbol ?? '').trim().slice(0, 20).toUpperCase();
  const fromName = clean(name, 16);
  if (fromName && !RESERVED.has(fromName)) return fromName;
  return `TOKEN-${addr.slice(2, 6).toUpperCase()}`;
}
