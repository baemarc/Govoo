import type { ReactNode } from 'react';
import { sb } from '../lib/supabase';
import { must } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { WorkerStatus } from '../lib/types';
import { ago } from '../lib/format';
import { CatDot, Panel } from '../components/ui';

export default function About() {
  const st = useAsync(async () => must(sb.from('worker_status').select('*').eq('id', 1).maybeSingle()) as Promise<WorkerStatus | null>, []);
  const s = st.data;
  const stale = s?.last_round_at ? Date.now() - Date.parse(s.last_round_at) > 20 * 60_000 : true;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Methodology</h1>
      <p className="text-sm leading-relaxed text-ink-2">
        Sonarc shows where a set of tracked wallets moves money on Arc. It reads token transfers on Arc
        mainnet, works out each tracked wallet's buys and sells, and sums them per token over nine time
        windows, from 15 minutes to a month. Token data is kept, not reset every 24 hours.
      </p>

      <Panel title="Wallet categories">
        <div className="space-y-3 px-4 py-4 text-sm text-ink-2">
          <Cat c="smart" name="Smart">Wallets that have been profitable recently. The list is recalculated and changes over time.</Cat>
          <Cat c="whale" name="Whale">Wallets holding a large position (at least 0.5% of supply or over $50K) in selected tokens. A whale keeps being tracked for up to 30 days after dropping below the threshold.</Cat>
          <Cat c="fomo" name="Fomo">Known fomo.family users, shown by username. Wallet addresses are never published.</Cat>
          <p className="text-ink-3">Each wallet counts in one category only. If it fits several, the order is Fomo, then Smart, then Whale. Past flows keep the category the wallet had at the time of the trade.</p>
        </div>
      </Panel>

      <Panel title="How flows are counted">
        <ul className="list-disc space-y-2 py-4 pl-9 pr-4 text-sm text-ink-2">
          <li><b className="text-ink">Inflow</b> is USDC a tracked wallet spent buying a token; <b className="text-ink">outflow</b> is USDC it received selling one. Net = inflow − outflow.</li>
          <li>Token-to-token swaps count as a sell of one and a buy of the other, priced in USD.</li>
          <li>Plain transfers between wallets are not flow. They only change the holding.</li>
          <li>Trades under $25 are not counted as flow, but still change the holding.</li>
          <li><b className="text-ink">Top tx</b> is the share of gross volume that came from the single largest trade. It's hidden when there are fewer than three trades.</li>
          <li><b className="text-ink">Holders</b> counts tracked wallets that hold the token now. The change is shown on the 4h, 12h, 24h, 1w and 1M windows.</li>
          <li><b className="text-ink">Rotation</b>: a wallet that sells token A and buys token B within the window counts as a rotation of the smaller of the two amounts.</li>
          <li>Average cost and PnL cover only the traded part of a holding. Tokens that arrived by transfer, or were held before tracking began, have no known cost and are marked separately.</li>
        </ul>
      </Panel>

      <Panel title="Data">
        <div className="space-y-2 px-4 py-4 text-sm text-ink-2">
          <p>Trades come from Arc mainnet logs. Prices, market cap and liquidity come from DexScreener, and total holder counts from the Arc explorer (every 4 hours).</p>
          <p>History starts at Arc mainnet launch, 16 September 2026. Data refreshes every 5 minutes; there is no live stream.</p>
          <p>Tokens can be removed by the maintainers (spam or scams). A removed token disappears everywhere and its data stops being collected.</p>
        </div>
      </Panel>

      <Panel title="Status">
        <dl className="grid grid-cols-2 gap-4 px-4 py-4 text-sm sm:grid-cols-3">
          <Item label="Last update">
            <span className={stale ? 'text-down' : 'text-up'}>{st.loading ? '…' : ago(s?.last_round_at)}</span>
          </Item>
          <Item label="Last block"><span className="num">{s?.last_block?.toLocaleString('en-US') ?? '—'}</span></Item>
          <Item label="Errors"><span className="num">{s?.error_count ?? '—'}</span></Item>
        </dl>
      </Panel>

      <p className="text-xs text-ink-3">Nothing here is financial advice. Sonarc is a statistics tool, not a signal service.</p>
    </div>
  );
}

function Cat({ c, name, children }: { c: 'smart' | 'whale' | 'fomo'; name: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-16 shrink-0 items-center gap-1.5 font-medium text-ink"><CatDot c={c} />{name}</div>
      <p>{children}</p>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
