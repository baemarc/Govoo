import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { sb } from '../lib/supabase';
import { fetchAll, must, tokenMap, walletMap } from '../lib/data';
import { useAdmin } from '../lib/useAdmin';
import { useAsync } from '../lib/useAsync';
import type { Cat } from '../lib/types';
import { ago } from '../lib/format';
import { CatTag, Panel, Seg, Status, td, th } from '../components/ui';

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const CAT_OPTS = [
  { key: 'smart', label: 'Smart' },
  { key: 'whale', label: 'Whale' },
  { key: 'fomo', label: 'Fomo' },
] as const;

export default function Admin() {
  const { session, isAdmin, ready } = useAdmin();
  const [reqRev, bumpReqs] = useState(0);
  if (!ready) return <Status loading />;
  if (!session) return <Login />;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-sm space-y-3 py-16 text-center text-sm text-ink-2">
        <p>Signed in as {session.user.email}, but this account isn't an admin.</p>
        <button onClick={() => sb.auth.signOut()} className="text-ink-3 hover:text-ink">Sign out</button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <div className="text-xs text-ink-3">
          {session.user.email} · <button onClick={() => sb.auth.signOut()} className="hover:text-ink">Sign out</button>
        </div>
      </div>
      <p className="text-xs text-ink-3">Changes are picked up by the worker on its next round (within 5 minutes).</p>
      <div className="grid gap-4 xl:grid-cols-2">
        <Wallets reqRev={reqRev} />
        <div className="space-y-4">
          <WhaleTokens />
          <TokenBlacklist />
          <WalletBlacklist onRestored={() => bumpReqs(n => n + 1)} />
        </div>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(error.message);
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm space-y-3 rounded-2xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">Admin sign in</h1>
      <Input value={email} onChange={setEmail} placeholder="Email" type="email" autoComplete="username" />
      <Input value={password} onChange={setPassword} placeholder="Password" type="password" autoComplete="current-password" />
      {err && <p className="text-sm text-down">{err}</p>}
      <Button disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}

interface AdminWallet { wallet_id: number; address: string; source: string; added_at: string; label: string | null }
interface WalletRequest { id: number; action: 'add' | 'remove' | 'restore'; address: string; category: Cat | null; label: string | null; created_at: string }

function Wallets({ reqRev }: { reqRev: number }) {
  const list = useAsync(async () => {
    const [adm, pub] = await Promise.all([
      fetchAll<AdminWallet>(() => sb.from('wallets_admin').select('*').order('wallet_id')),
      walletMap(),
    ]);
    return adm.map(a => ({ ...a, pub: pub.get(a.wallet_id) }));
  }, []);
  const reqs = useAsync(async () => (await must(sb.from('wallet_requests').select('*').order('id'))) as WalletRequest[] ?? [], [reqRev]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat | 'any'>('any');

  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (list.data ?? []).filter(w => (cat === 'any' || w.pub?.category === cat)
      && (!n || w.address.includes(n) || (w.label ?? w.pub?.label ?? '').toLowerCase().includes(n)));
  }, [list.data, q, cat]);

  async function remove(address: string, label: string) {
    if (!window.confirm(`Remove ${label} (${address})?\nThe wallet is deleted with its full history and blacklisted.`)) return;
    await act(() => must(sb.from('wallet_requests').insert({ action: 'remove', address: address.toLowerCase() })));
    reqs.reload();
  }

  return (
    <Panel title={<>Tracked wallets <span className="font-normal text-ink-3">· {list.data?.length ?? 0}</span></>}>
      <AddWallet onDone={reqs.reload} />
      {!!reqs.data?.length && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-2 text-[11px] uppercase tracking-wide text-ink-3">Pending ({reqs.data.length})</div>
          <ul className="space-y-1 text-xs">
            {reqs.data.map(r => (
              <li key={r.id} className="flex items-center gap-2">
                <span className={r.action === 'remove' ? 'text-down' : 'text-up'}>{r.action}</span>
                <span className="mono text-ink-2">{r.address}</span>
                {r.category && <CatTag c={r.category} />}
                <span className="text-ink-3">{r.label}</span>
                <button className="ml-auto text-ink-3 hover:text-down" title="Cancel request"
                  onClick={async () => { await act(() => must(sb.from('wallet_requests').delete().eq('id', r.id))); reqs.reload(); }}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Seg<Cat | 'any'> label="Category" value={cat} onChange={setCat} options={[{ key: 'any', label: 'All' }, ...CAT_OPTS]} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Address or label"
          className="ml-auto w-48 rounded-md border border-line bg-bg px-3 py-1.5 text-sm placeholder:text-ink-3 focus:outline-none" />
      </div>
      <div className="max-h-[720px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-line bg-surface">
            <tr>
              <th className={th}>Wallet</th>
              <th className={th}>Address</th>
              <th className={th}>Source</th>
              <th className={th}>Added</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {view.slice(0, 500).map(w => (
              <tr key={w.wallet_id}>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    {w.pub && <CatTag c={w.pub.category} />}
                    <span className="max-w-32 truncate text-ink-2">{w.label ?? w.pub?.label ?? ''}</span>
                  </div>
                </td>
                <td className={`${td} mono text-xs`}>
                  <a href={`https://arcexplorer.org/address/${w.address}`} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink">{w.address}</a>
                </td>
                <td className={`${td} text-xs text-ink-3`}>{w.source}</td>
                <td className={`${td} text-xs text-ink-3`}>{ago(w.added_at)}</td>
                <td className={td}>
                  <button onClick={() => remove(w.address, w.label ?? w.pub?.label ?? `#${w.wallet_id}`)} title="Remove wallet"
                    className="rounded px-1.5 text-ink-3 hover:bg-down/15 hover:text-down">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Status loading={list.loading && !list.data} error={list.error ?? reqs.error}
        empty={!list.loading && !view.length ? 'No wallets match.' : undefined} />
    </Panel>
  );
}

function AddWallet({ onDone, restore, onCancel }: { onDone: () => void; restore?: string; onCancel?: () => void }) {
  const [address, setAddress] = useState(restore ?? '');
  const [cat, setCat] = useState<Cat>('fomo');
  const [handle, setHandle] = useState('');
  const [display, setDisplay] = useState('');
  const [label, setLabel] = useState('');
  const valid = ADDR.test(address.trim()) && (cat !== 'fomo' || handle.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const l = cat === 'fomo' ? (display.trim() || `@${handle.trim().replace(/^@/, '')}`) : cat === 'whale' ? label.trim() || null : null;
    const ok = await act(() => must(sb.from('wallet_requests').insert({
      action: restore ? 'restore' : 'add', address: address.trim().toLowerCase(), category: cat, label: l,
    })));
    if (ok) { setAddress(''); setHandle(''); setDisplay(''); setLabel(''); onDone(); }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg<Cat> label="New wallet category" value={cat} onChange={setCat} options={CAT_OPTS} />
        {restore
          ? <span className="mono flex-1 text-xs text-ink-2">{restore}</span>
          : <Input value={address} onChange={setAddress} placeholder="0x… address" className="mono min-w-72 flex-1" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {cat === 'fomo' && <>
          <Input value={handle} onChange={setHandle} placeholder="fomo.family username (required)" className="flex-1" />
          <Input value={display} onChange={setDisplay} placeholder="Display name" className="flex-1" />
        </>}
        {cat === 'whale' && <Input value={label} onChange={setLabel} placeholder="Label, e.g. WHALE-LONG-3 (optional)" className="flex-1" />}
        {cat === 'smart' && <span className="flex-1 text-xs text-ink-3">Smart wallets are shown as "Smart Wallet"; no label needed.</span>}
        <Button disabled={!valid}>{restore ? 'Restore wallet' : 'Add wallet'}</Button>
        {onCancel && <button type="button" onClick={onCancel} className="text-xs text-ink-3 hover:text-ink">Cancel</button>}
      </div>
    </form>
  );
}

interface WhaleToken { token: string; symbol: string | null; added_at: string; last_scanned_at: string | null; whale_count: number }

function WhaleTokens() {
  const list = useAsync(async () => (await must(sb.from('whale_tokens').select('*').order('added_at'))) as WhaleToken[] ?? [], []);
  const [addr, setAddr] = useState('');
  const [sym, setSym] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const a = addr.trim().toLowerCase();
    if (!ADDR.test(a)) return;
    const symbol = sym.trim() || (await tokenMap().catch(() => null))?.get(a)?.symbol || null;
    if (await act(() => must(sb.from('whale_tokens').insert({ token: a, symbol })))) { setAddr(''); setSym(''); list.reload(); }
  }

  return (
    <Panel title="Whale token list">
      <form onSubmit={add} className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        <Input value={addr} onChange={setAddr} placeholder="Token address" className="mono min-w-64 flex-1" />
        <Input value={sym} onChange={setSym} placeholder="Symbol" className="w-28" />
        <Button disabled={!ADDR.test(addr.trim())}>Add</Button>
      </form>
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr><th className={th}>Token</th><th className={th}>Last scan</th><th className={`${th} text-right`}>Whales</th><th className={th} /></tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {list.data?.map(w => (
            <tr key={w.token}>
              <td className={td}><span className="font-medium">{w.symbol ?? '—'}</span> <span className="mono text-xs text-ink-3">{w.token}</span></td>
              <td className={`${td} text-xs text-ink-3`}>{w.last_scanned_at ? ago(w.last_scanned_at) : 'never'}</td>
              <td className={`${td} num text-right`}>{w.whale_count}</td>
              <td className={td}><RemoveBtn onClick={async () => {
                if (window.confirm(`Stop whale scans for ${w.symbol ?? w.token}?`)
                  && await act(() => must(sb.from('whale_tokens').delete().eq('token', w.token)))) list.reload();
              }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Status loading={list.loading && !list.data} error={list.error} empty={!list.loading && !list.data?.length ? 'No whale tokens yet.' : undefined} />
    </Panel>
  );
}

interface Listed { address: string; reason: string | null; added_at: string }

function TokenBlacklist() {
  const list = useAsync(async () => (await must(sb.from('token_blacklist').select('*').order('added_at', { ascending: false }))) as Listed[] ?? [], []);
  const tokens = useAsync(tokenMap, []);
  const [addr, setAddr] = useState('');
  const [reason, setReason] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    const a = addr.trim().toLowerCase();
    if (!ADDR.test(a)) return;
    if (await act(() => must(sb.from('token_blacklist').insert({ address: a, reason: reason.trim() || null })))) { setAddr(''); setReason(''); list.reload(); }
  }

  return (
    <Panel title={<>Removed tokens <span className="font-normal text-ink-3">· {list.data?.length ?? 0}</span></>}>
      <form onSubmit={add} className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        <Input value={addr} onChange={setAddr} placeholder="Token address" className="mono min-w-64 flex-1" />
        <Input value={reason} onChange={setReason} placeholder="Reason" className="w-36" />
        <Button disabled={!ADDR.test(addr.trim())}>Remove token</Button>
      </form>
      <ListTable rows={list.data} label={a => tokens.data?.get(a)?.symbol ?? null}
        onRestore={async a => {
          if (window.confirm('Restore this token? Data from the blacklisted period stays empty.')
            && await act(() => must(sb.from('token_blacklist').delete().eq('address', a)))) list.reload();
        }} />
      <Status loading={list.loading && !list.data} error={list.error} empty={!list.loading && !list.data?.length ? 'No removed tokens.' : undefined} />
    </Panel>
  );
}

function WalletBlacklist({ onRestored }: { onRestored: () => void }) {
  const list = useAsync(async () => (await must(sb.from('wallet_blacklist').select('*').order('added_at', { ascending: false }))) as Listed[] ?? [], []);
  const [restoring, setRestoring] = useState<string | null>(null);
  return (
    <Panel title={<>Removed wallets <span className="font-normal text-ink-3">· {list.data?.length ?? 0}</span></>}>
      {restoring && <AddWallet key={restoring} restore={restoring} onCancel={() => setRestoring(null)}
        onDone={() => { setRestoring(null); list.reload(); onRestored(); }} />}
      <ListTable rows={list.data} label={() => null} onRestore={setRestoring} />
      <Status loading={list.loading && !list.data} error={list.error} empty={!list.loading && !list.data?.length ? 'No removed wallets.' : undefined} />
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Removed wallets aren't re-added by whale scans. Restoring re-adds the wallet on the worker's next round; its history is rebuilt by a backfill.</p>
    </Panel>
  );
}

function ListTable({ rows, label, onRestore }: { rows: Listed[] | undefined; label: (a: string) => string | null; onRestore?: (a: string) => void }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line/60">
          {rows?.map(r => (
            <tr key={r.address}>
              <td className={td}>
                {label(r.address) && <span className="mr-2 font-medium">{label(r.address)}</span>}
                <span className="mono text-xs text-ink-3">{r.address}</span>
              </td>
              <td className={`${td} text-xs text-ink-3`}>{r.reason ?? ''}</td>
              <td className={`${td} text-xs text-ink-3`}>{ago(r.added_at)}</td>
              {onRestore && <td className={td}>
                <button onClick={() => onRestore(r.address)} className="text-xs text-ink-3 hover:text-ink">Restore</button>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function act(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return true; } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e));
    return false;
  }
}

function Input({ value, onChange, className = '', ...rest }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; type?: string; autoComplete?: string;
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} {...rest}
      className={`rounded-md border border-line bg-bg px-3 py-1.5 text-sm placeholder:text-ink-3 focus:border-ink-3 focus:outline-none ${className}`} />
  );
}

function Button({ children, disabled, className = '' }: { children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="submit" disabled={disabled}
      className={`rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:brightness-110 disabled:opacity-40 ${className}`}>
      {children}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="rounded px-1.5 text-ink-3 hover:bg-down/15 hover:text-down">✕</button>;
}
