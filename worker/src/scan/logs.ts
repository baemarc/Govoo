import { TRANSFER_TOPIC } from '../chain.js';
import type { RawLog } from '../rpc.js';
import type { Leg } from './resolve.js';

export const padTopic = (addr: string) => '0x' + addr.slice(2).toLowerCase().padStart(64, '0');

export function toLeg(l: RawLog): Leg | null {
  if (l.topics[0] !== TRANSFER_TOPIC || l.topics.length !== 3) return null;
  if (!l.data || l.data === '0x') return null;
  return {
    token: l.address.toLowerCase(),
    from: '0x' + l.topics[1]!.slice(26).toLowerCase(),
    to: '0x' + l.topics[2]!.slice(26).toLowerCase(),
    amount: BigInt(l.data.slice(0, 66)),
  };
}
