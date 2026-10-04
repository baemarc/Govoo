import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(WORKER_DIR, '..', '.env') });

function optional(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function required(name: string): string {
  const v = optional(name);
  if (!v) throw new Error(`${name} is not set (.env)`);
  return v;
}

export function num(name: string): number {
  const v = Number(required(name));
  if (!Number.isFinite(v)) throw new Error(`${name} must be a number (.env)`);
  return v;
}

export const env = {
  rpcUrls: (optional('ARC_RPC_URL') ?? 'https://rpc.mainnet.arc.io').split(',').map(s => s.trim()),
  dbPath: path.resolve(WORKER_DIR, optional('GOVOO_DB') ?? './data/govoo.db'),
};
