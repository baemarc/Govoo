import type { CSSProperties, ReactNode } from 'react';
import { sb } from '../lib/supabase';
import { must } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import type { Cat, WorkerStatus } from '../lib/types';
import { ago } from '../lib/format';
import { CAT_COLOR, Card, CatDot, PageHead, Panel } from '../components/ui';

export default function About() {
  const st = useAsync(async () => must(sb.from('worker_status').select('*').eq('id', 1).maybeSingle()) as Promise<WorkerStatus | null>, []);
  const s = st.data;
  const stale = s?.last_round_at ? Date.now() - Date.parse(s.last_round_at) > 20 * 60_000 : true;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHead title="Methodology"
        desc="Govoo reads token transfers on Arc mainnet, works out each tracked wallet's buys and sells, and sums them per token over nine time windows, from 15 minutes to a month. Token data is kept, not reset every 24 hours." />

      <div className="grid gap-4 sm:grid-cols-3">
        <Status i={1} label="Last update">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex size-2">
              {!stale && <span className="ping absolute inset-0 rounded-full bg-up" />}
              <span className={`relative size-2 rounded-full ${stale ? 'bg-down' : 'bg-up'}`} />
            </span>
            {st.loading ? '…' : ago(s?.last_round_at)}
          </span>
        </Status>
        <Status i={2} label="Last block">{s?.last_block?.toLocaleString('en-US') ?? '—'}</Status>
        <Status i={3} label="Errors">{s?.error_count ?? '—'}</Status>
      </div>

      <section className="space-y-4">
        <h2 className="rise text-xl font-semibold tracking-[-0.03em]" style={{ '--i': 4 } as CSSProperties}>Wallet categories</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <CatCard i={5} c="smart" name="Smart">Wallets that have been profitable recently. The list is recalculated and changes over time.</CatCard>
          <CatCard i={6} c="whale" name="Whale">Wallets holding a large position (at least 0.5% of supply or over $50K) in selected tokens. A whale stays tracked for up to 30 days after dropping below the threshold.</CatCard>
          <CatCard i={7} c="fomo" name="Fomo">Known fomo.family users, shown by username. Wallet addresses are never published.</CatCard>
        </div>
        <p className="text-sm leading-relaxed text-ink-3">Each wallet counts in one category only. If it fits several, the order is Fomo, then Smart, then Whale. Past flows keep the category the wallet had at the time of the trade.</p>
      </section>

      <Panel className="rise" style={{ '--i': 8 } as CSSProperties} title="How flows are counted">
        <ol className="grid gap-px overflow-hidden rounded-b-[1.25rem] border-t border-white/[0.05] bg-white/[0.04] sm:grid-cols-2">
          <Rule n={1} t="Inflow and outflow">Inflow is USDC a tracked wallet spent buying a token; outflow is USDC it received selling one. Net = inflow − outflow.</Rule>
          <Rule n={2} t="Swaps">Token-to-token swaps count as a sell of one and a buy of the other, priced in USD.</Rule>
          <Rule n={3} t="Transfers">Plain transfers between wallets are not flow. They only change the holding.</Rule>
          <Rule n={4} t="Floor">Trades under $25 are not counted as flow, but still change the holding.</Rule>
          <Rule n={5} t="Top trade">The share of gross volume that came from the single largest trade. Hidden when there are fewer than three trades.</Rule>
          <Rule n={6} t="Holders">Tracked wallets that hold the token now. The change is shown on the 4h, 12h, 24h, 1w and 1M windows.</Rule>
          <Rule n={7} t="Rotation">A wallet that sells token A and buys token B within the window counts as a rotation of the smaller of the two amounts.</Rule>
          <Rule n={8} t="Cost and PnL">Average cost and PnL cover only the traded part of a holding. Tokens that arrived by transfer, or were held before tracking began, have no known cost.</Rule>
        </ol>
      </Panel>

      <p className="text-xs text-ink-3">Nothing here is financial advice. Govoo is a statistics tool, not a signal service.</p>
    </div>
  );
}

function Status({ label, children, i }: { label: string; children: ReactNode; i: number }) {
  return (
    <Card className="rise p-5" style={{ '--i': i } as CSSProperties}>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="num mt-2 text-xl font-semibold tracking-[-0.04em]">{children}</div>
    </Card>
  );
}

function CatCard({ c, name, children, i }: { c: Cat; name: string; children: ReactNode; i: number }) {
  return (
    <Card className="rise overflow-hidden p-5" style={{ '--i': i } as CSSProperties}>
      <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-25 blur-3xl" style={{ background: CAT_COLOR[c] }} aria-hidden />
      <div className="relative flex items-center gap-2 text-[15px] font-semibold tracking-tight"><CatDot c={c} size="size-2.5" />{name}</div>
      <p className="relative mt-3 text-sm leading-relaxed text-ink-2">{children}</p>
    </Card>
  );
}

function Rule({ n, t, children }: { n: number; t: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 bg-surface px-5 py-4">
      <span className="num grid size-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent/20 to-accent-2/20 text-[11px] font-semibold text-ink">{n}</span>
      <div>
        <div className="text-sm font-medium text-ink">{t}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{children}</p>
      </div>
    </li>
  );
}
