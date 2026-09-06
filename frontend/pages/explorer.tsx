// Explorer — Condition's slice of Midnight Preprod, in the information
// architecture of a blockchain explorer: network status, search, latest
// activity (live block scan), the Condition contract registry, and full
// tx / receipt detail views with hashes, blocks, timestamps and statuses.
//
// Two honesty layers distinguish it from a generic explorer:
//   1. PUBLIC vs PRIVATE: every row is tagged with what the chain actually
//      exposes. The explorer demonstrates Condition's privacy model — a
//      settlement is visible, its amount and claimant are not, and the UI
//      says so in place of the data (█ redaction, not omission).
//   2. LIVE vs REFERENCE: everything under "network / blocks / txs /
//      contract state" is fetched live from the indexer at view time.
//      Only the static registry metadata (which deployment is which) is
//      committed documentation, and it is labeled as such.
//
// URL-driven: /explorer?t=<64hex> (tx detail), /explorer?b=<height> (block
// detail), /explorer?c=<address> (contract detail). Search routes all three
// shapes plus receipt ids to /verify.

import Head from 'next/head';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_INDEXER_HTTP,
  PREPROD_DEPLOYMENTS,
  explorerTxUrl,
  explorerUrl,
  fetchBlockByHeight,
  fetchChainHead,
  fetchContractHead,
  fetchPolicyState,
  fetchSettlementState,
  fetchTxByHash,
  type BlockSummary,
  type PolicyPublicState,
  type SettlementPublicState,
  type TxSummary,
} from '../../src/utils/publicChain';
import { receiptIdDigest } from '../../src/core/hashing';

type ChainState =
  | { kind: 'loading' }
  | { kind: 'down'; message: string }
  | { kind: 'up'; head: { height: number; timeMs: number } };

const HEAD_REFRESH_MS = 15_000;
const SCAN_BLOCKS = 12;

type ExplorerView =
  | { kind: 'overview' }
  | { kind: 'tx'; hash: string }
  | { kind: 'block'; height: number }
  | { kind: 'contract'; address: string }
  | { kind: 'query'; q: string };

/** Read the URL-driven detail view (no Next router — pages stay testable). */
function viewFromLocation(): ExplorerView {
  if (typeof window === 'undefined') return { kind: 'overview' };
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  const b = params.get('b');
  const c = params.get('c');
  const q = params.get('q');
  if (t && /^[0-9a-fA-F]{64}$/.test(t.replace(/^0x/, ''))) {
    return { kind: 'tx', hash: t.replace(/^0x/, '').toLowerCase() };
  }
  if (b && /^\d+$/.test(b)) {
    return { kind: 'block', height: Number(b) };
  }
  if (c && /^[0-9a-fA-F]{64}$/.test(c.replace(/^0x/, ''))) {
    return { kind: 'contract', address: c.replace(/^0x/, '').toLowerCase() };
  }
  if (q) {
    return { kind: 'query', q };
  }
  return { kind: 'overview' };
}

export default function ExplorerPage() {
  const [chain, setChain] = useState<ChainState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ExplorerView>({ kind: 'overview' });

  const loadHead = useCallback(async () => {
    try {
      const head = await fetchChainHead(DEFAULT_INDEXER_HTTP);
      setChain({ kind: 'up', head });
    } catch (err) {
      setChain({ kind: 'down', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    setView(viewFromLocation());
    void loadHead();
    const t = setInterval(() => void loadHead(), HEAD_REFRESH_MS);
    return () => clearInterval(t);
  }, [loadHead]);

  const submitSearch = useCallback(() => {
    const q = search.trim().replace(/^0x/, '');
    if (!q) return;
    // 64-hex ids are tx hashes / contract addresses / receipt ids — route to
    // the tx detail, which offers the contract and verifier fallbacks.
    if (/^[0-9a-fA-F]{64}$/.test(q)) {
      window.location.href = `/explorer?t=${q.toLowerCase()}`;
      return;
    }
    if (/^\d+$/.test(q)) {
      window.location.href = `/explorer?b=${q}`;
      return;
    }
    window.location.href = `/explorer?q=${encodeURIComponent(q)}`;
  }, [search]);

  if (view.kind === 'tx') return <ExplorerShell><TxDetail hash={view.hash} /></ExplorerShell>;
  if (view.kind === 'block') return <ExplorerShell><BlockDetail height={view.height} /></ExplorerShell>;
  if (view.kind === 'contract') return <ExplorerShell><ContractDetail address={view.address} /></ExplorerShell>;
  if (view.kind === 'query') return <ExplorerShell><QueryDetail q={view.q} /></ExplorerShell>;

  return (
    <ExplorerShell>
      <Head>
        <title>Explorer — Condition on Midnight Preprod</title>
        <meta
          property="og:title"
          content="Condition Explorer — the public side of private settlements"
        />
      </Head>

      <div className="page-head">
        <span className="stamp">[ condition explorer · midnight preprod · read-only ]</span>
        <h1 className="section-title">The public side of private settlements.</h1>
        <p className="section-sub">
          Live Midnight Preprod data: blocks, transactions, Condition's
          deployed contracts and the public receipts they publish. Where the
          chain deliberately holds nothing — amounts, claimants — this
          explorer shows the redaction instead of pretending the data is
          absent by accident.
        </p>
      </div>

      {/* Network status bar — explorer standard */}
      <NetworkStatusBar chain={chain} />

      {/* Search — routes txs, blocks, contracts, receipt ids */}
      <div className="card explorer-search">
        <label htmlFor="explorer-search">Search blocks, transactions, contracts or receipt ids</label>
        <div className="button-row" style={{ marginTop: 4 }}>
          <input
            id="explorer-search"
            className="explorer-search-input"
            placeholder="tx hash · block height · contract address · 0x-receipt-id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
            spellCheck={false}
          />
          <button className="button primary" onClick={submitSearch}>Search</button>
        </div>
        <p className="proof-note" style={{ margin: '10px 0 0' }}>
          A 64-hex id that is not a transaction is treated as a receipt id and
          sent to the independent verifier.
        </p>
      </div>

      {chain.kind === 'up' && <LatestActivity head={chain.head} />}

      <ContractRegistry chain={chain} />

    </ExplorerShell>
  );
}

/** Shared chrome for every explorer view (title + privacy footer). */
function ExplorerShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Head>
        <title>Explorer — Condition on Midnight Preprod</title>
        <meta
          property="og:title"
          content="Condition Explorer — the public side of private settlements"
        />
      </Head>
      {children}
      <div className="privacy-note">
        <span className="lock">⚖</span>
        <span>
          Everything here is read-only, fetched live from the Midnight Preprod
          indexer in your browser — no Condition server, no API routes, no
          session. Private data is absent because the protocol never
          published it; this UI does not soften that fact.
        </span>
      </div>
    </>
  );
}

/** Free-text query that matched nothing routable. */
function QueryDetail({ q }: { q: string }) {
  return (
    <DetailFrame stamp="[ search ]" title={`"${q.slice(0, 32)}"`} backTo="/explorer">
      <div className="empty">not a tx hash, contract address, receipt id or block height this explorer can route</div>
      <p className="proof-note">
        Try a 64-hex id (transactions, contracts, receipt ids) or a block
        height. Receipt verification lives at{' '}
        <a className="explorer-link" href="/verify">/verify →</a>
      </p>
    </DetailFrame>
  );
}

// ---------------------------------------------------------------------------
// Network status
// ---------------------------------------------------------------------------

function NetworkStatusBar({ chain }: { chain: ChainState }) {
  if (chain.kind === 'loading') {
    return (
      <div className="card explorer-status" role="status">
        <span className="stamp">[ network status ]</span> probing Midnight Preprod indexer…
      </div>
    );
  }
  if (chain.kind === 'down') {
    return (
      <div className="card explorer-status" role="status">
        <span className="stamp">[ network status ]</span>
        <span className="status FAILED">INDEXER DOWN</span>
        <span className="proof-note"> {chain.message}</span>
      </div>
    );
  }
  const age = Math.max(0, Math.floor((Date.now() - chain.head.timeMs) / 1000));
  return (
    <div className="card explorer-status" role="status">
      <span className="stamp">[ network status ]</span>
      <span className="status SUCCESS">MIDNIGHT PREPROD</span>
      <dl className="explorer-status-grid">
        <div><dt>head block</dt><dd><code>{chain.head.height.toLocaleString()}</code></dd></div>
        <div><dt>head time</dt><dd className="mono-row">{new Date(chain.head.timeMs).toISOString()}</dd></div>
        <div><dt>age</dt><dd className="mono-row">{age}s ago</dd></div>
        <div>
          <dt>explorer</dt>
          <dd>
            <a href="https://preprod.midnightexplorer.com" target="_blank" rel="noreferrer">
              preprod.midnightexplorer.com ↗
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Latest activity — live scan of recent blocks
// ---------------------------------------------------------------------------

interface ScanRow {
  height: number;
  timeMs: number;
  txHash: string;
  status: string;
  contractAddresses: string[];
}

function LatestActivity({ head }: { head: { height: number; timeMs: number } }) {
  const [rows, setRows] = useState<ScanRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const found: ScanRow[] = [];
      const top = Math.min(head.height, head.height + 1);
      for (let h = top; h > top - SCAN_BLOCKS && h > 0; h--) {
        try {
          const block: BlockSummary | null = await fetchBlockByHeight(DEFAULT_INDEXER_HTTP, h);
          if (cancelled) return;
          if (!block) continue;
          for (const t of block.transactions) {
            found.push({
              height: block.height,
              timeMs: block.timeMs,
              txHash: t.hash,
              status: t.status,
              contractAddresses: t.contractAddresses,
            });
          }
          if (found.length >= 10) break;
        } catch {
          if (cancelled) return;
          // single-block fetch failure: skip, keep scanning
        }
      }
      if (!cancelled) setRows(found);
    };
    setRows(null);
    void scan();
    return () => { cancelled = true; };
  }, [head.height]);

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div className="explorer-card-head">
        <span className="stamp">[ latest activity · live block scan ]</span>
        <span className="mono-row">last {SCAN_BLOCKS} blocks from head</span>
      </div>
      {rows === null ? (
        <div className="empty">scanning blocks…</div>
      ) : rows.length === 0 ? (
        <div className="empty">no transactions in the last {SCAN_BLOCKS} blocks — the chain is quiet</div>
      ) : (
        <table>
          <thead>
            <tr><th>Block</th><th>Tx</th><th>Status</th><th>Contracts touched</th><th>Time</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.txHash}>
                <td><code>{r.height.toLocaleString()}</code></td>
                <td>
                  <a className="explorer-link mono-row" href={`/explorer?t=${r.txHash}`} title={r.txHash}>
                    {short(r.txHash)}
                  </a>
                </td>
                <td><span className={`status ${r.status}`}>{r.status}</span></td>
                <td className="mono-row">
                  {r.contractAddresses.length === 0
                    ? '—'
                    : r.contractAddresses.map((a) => (
                        <a key={a} className="explorer-link" href={`/explorer?c=${a}`} title={a}>
                          {short(a)}
                        </a>
                      ))}
                </td>
                <td className="mono-row">{new Date(r.timeMs).toISOString().slice(11, 19)}Z</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contract registry — Condition's known deployments (live state, static labels)
// ---------------------------------------------------------------------------

function ContractRegistry({ chain }: { chain: ChainState }) {
  const [heads, setHeads] = useState<Record<string, { txHash: string; blockHeight: number; status: string } | null> | null>(null);

  useEffect(() => {
    if (chain.kind !== 'up') return;
    let cancelled = false;
    void (async () => {
      const out: Record<string, { txHash: string; blockHeight: number; status: string } | null> = {};
      for (const d of PREPROD_DEPLOYMENTS) {
        for (const addr of [d.policyAddress, d.settlementAddress]) {
          out[addr] = await fetchContractHead(DEFAULT_INDEXER_HTTP, addr).catch(() => null);
          if (cancelled) return;
        }
      }
      setHeads(out);
    })();
    return () => { cancelled = true; };
  }, [chain.kind]);

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <div className="explorer-card-head">
        <span className="stamp">[ condition contract registry ]</span>
        <span className="mono-row">deployments · labels are committed docs, state is live</span>
      </div>
      <table>
        <thead>
          <tr><th>Contract</th><th>Role</th><th>Address</th><th>Latest activity</th><th>Links</th></tr>
        </thead>
        <tbody>
          {PREPROD_DEPLOYMENTS.map((d) => (
            <ContractRegistryRow
              key={d.policyAddress}
              label={d.label}
              policyAddress={d.policyAddress}
              settlementAddress={d.settlementAddress}
              heads={heads}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractRegistryRow({ label, policyAddress, settlementAddress, heads }: {
  label: string;
  policyAddress: string;
  settlementAddress: string;
  heads: Record<string, { txHash: string; blockHeight: number; status: string } | null> | null;
}) {
  return (
    <>
      <tr>
        <td rowSpan={2} className="explorer-deployment">{label}</td>
        <td>policy instance</td>
        <td>
          <a className="explorer-link mono-row" href={`/explorer?c=${policyAddress}`} title={policyAddress}>
            {short(policyAddress)}
          </a>
        </td>
        <HeadCell head={heads?.[policyAddress]} />
        <td>
          <a className="explorer-link" href={explorerUrl(policyAddress)} target="_blank" rel="noreferrer">Midnight ↗</a>
        </td>
      </tr>
      <tr>
        <td>settlement instance</td>
        <td>
          <a className="explorer-link mono-row" href={`/explorer?c=${settlementAddress}`} title={settlementAddress}>
            {short(settlementAddress)}
          </a>
        </td>
        <HeadCell head={heads?.[settlementAddress]} />
        <td>
          <a className="explorer-link" href={explorerUrl(settlementAddress)} target="_blank" rel="noreferrer">Midnight ↗</a>
        </td>
      </tr>
    </>
  );
}

function HeadCell({ head }: { head?: { txHash: string; blockHeight: number; status: string } | null }) {
  if (head === null) {
    return <td className="mono-row">no indexed action (recent-contract quirk)</td>;
  }
  if (head === undefined) {
    return <td className="mono-row">checking…</td>;
  }
  return (
    <td>
      <a className="explorer-link mono-row" href={`/explorer?t=${head.txHash}`}>
        {short(head.txHash)} · block {head.blockHeight.toLocaleString()} ·{' '}
        <span className={`status ${head.status}`}>{head.status}</span>
      </a>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Detail views (URL-driven)
// ---------------------------------------------------------------------------

export function TxDetail({ hash }: { hash: string }) {
  const [tx, setTx] = useState<TxSummary | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const t = await fetchTxByHash(DEFAULT_INDEXER_HTTP, hash);
        if (!cancelled) setTx(t);
      } catch {
        if (!cancelled) setTx('error');
      }
    })();
    return () => { cancelled = true; };
  }, [hash]);

  if (tx === null) {
    return (
      <DetailFrame stamp="[ transaction ]" title={`tx ${short(hash)}`}>
        <div className="empty">this hash is not a transaction on Midnight Preprod</div>
        <p className="proof-note">
          If it is a Condition receipt id,{' '}
          <a className="explorer-link" href={`/verify?receipt=0x${hash.replace(/^0x/, '')}`}>
            run it through the independent verifier →
          </a>
        </p>
      </DetailFrame>
    );
  }
  if (tx === 'error') {
    return (
      <DetailFrame stamp="[ transaction ]" title={`tx ${short(hash)}`}>
        <div className="empty">indexer unreachable — nothing claimed</div>
      </DetailFrame>
    );
  }
  const isCondition = tx.actions.some((a) => PREPROD_DEPLOYMENTS.some((d) => d.policyAddress === a.address || d.settlementAddress === a.address));
  return (
    <DetailFrame
      stamp="[ transaction ]"
      title={tx.actions[0]?.entryPoint ? `Condition · ${tx.actions[0].entryPoint}()` : `tx ${short(hash)}`}
      backTo="/explorer"
    >
      <dl className="evidence">
        <div className="evidence-row"><dt>tx hash</dt><dd title={tx.hash}>{tx.hash}</dd></div>
        <div className="evidence-row"><dt>status</dt><dd><span className={`status ${tx.status}`}>{tx.status}</span></dd></div>
        <div className="evidence-row"><dt>block</dt><dd><a className="explorer-link" href={`/explorer?b=${tx.blockHeight}`}>{tx.blockHeight.toLocaleString()}</a></dd></div>
        <div className="evidence-row"><dt>time</dt><dd>{new Date(tx.blockTimeMs).toISOString()}</dd></div>
        {tx.actions.map((a, i) => (
          <div className="evidence-row" key={i}>
            <dt>{a.entryPoint ? `call · ${a.entryPoint}()` : 'contract action'}</dt>
            <dd>
              <a className="explorer-link" href={`/explorer?c=${a.address}`}>{a.address}</a>
            </dd>
          </div>
        ))}
        <div className="evidence-row">
          <dt>on midnight explorer</dt>
          <dd><a className="explorer-link" href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer">open ↗</a></dd>
        </div>
      </dl>
      {isCondition && (
        <p className="proof-note">
          A Condition circuit call publishes: public arguments, commitments,
          nullifiers (settlement only), proof hashes and state transitions.
          It never publishes witnesses, amounts or identities.
        </p>
      )}
    </DetailFrame>
  );
}

export function BlockDetail({ height }: { height: number }) {
  const [block, setBlock] = useState<BlockSummary | null | 'error'>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const b = await fetchBlockByHeight(DEFAULT_INDEXER_HTTP, height);
        if (!cancelled) setBlock(b);
      } catch {
        if (!cancelled) setBlock('error');
      }
    })();
    return () => { cancelled = true; };
  }, [height]);

  if (block === null) {
    return (
      <DetailFrame stamp="[ block ]" title={`block ${height.toLocaleString()}`} backTo="/explorer">
        <div className="empty">no block at this height on Midnight Preprod</div>
      </DetailFrame>
    );
  }
  if (block === 'error') {
    return (
      <DetailFrame stamp="[ block ]" title={`block ${height.toLocaleString()}`} backTo="/explorer">
        <div className="empty">indexer unreachable — nothing claimed</div>
      </DetailFrame>
    );
  }
  return (
    <DetailFrame stamp="[ block ]" title={`block ${block.height.toLocaleString()}`} backTo="/explorer">
      <dl className="evidence">
        <div className="evidence-row"><dt>height</dt><dd>{block.height.toLocaleString()}</dd></div>
        <div className="evidence-row"><dt>time</dt><dd>{new Date(block.timeMs).toISOString()}</dd></div>
        <div className="evidence-row"><dt>transactions</dt><dd>{block.transactions.length}</dd></div>
      </dl>
      {block.transactions.length > 0 && (
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Tx</th><th>Status</th><th>Contracts</th></tr></thead>
          <tbody>
            {block.transactions.map((t) => (
              <tr key={t.hash}>
                <td><a className="explorer-link mono-row" href={`/explorer?t=${t.hash}`}>{short(t.hash)}</a></td>
                <td><span className={`status ${t.status}`}>{t.status}</span></td>
                <td className="mono-row">
                  {t.contractAddresses.length === 0 ? '—' : t.contractAddresses.map((a) => (
                    <a key={a} className="explorer-link" href={`/explorer?c=${a}`}>{short(a)}</a>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DetailFrame>
  );
}

export function ContractDetail({ address }: { address: string }) {
  const [data, setData] = useState<{
    state: 'loading';
  } | {
    state: 'missing';
  } | {
    state: 'error';
    message: string;
  } | {
    state: 'ready';
    head: { txHash: string; blockHeight: number; timeMs: number; status: string } | null;
    settlement?: SettlementPublicState;
    policy?: PolicyPublicState;
    receiptId?: string;
  }>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const head = await fetchContractHead(DEFAULT_INDEXER_HTTP, address).catch(() => null);
        // Try settlement shape first, then policy shape — the deployed code
        // decides, not a label.
        let settlement: SettlementPublicState | undefined;
        let policy: PolicyPublicState | undefined;
        try {
          settlement = await fetchSettlementState(DEFAULT_INDEXER_HTTP, address);
        } catch {
          try {
            policy = await fetchPolicyState(DEFAULT_INDEXER_HTTP, address);
          } catch {
            if (!cancelled) setData({ state: 'missing' });
            return;
          }
        }
        let receiptId: string | undefined;
        if (settlement && settlement.lastTimestamp > 0n) {
          receiptId = receiptIdDigest(
            settlement.policyId,
            settlement.lastReceiptHash,
            settlement.triggerFired,
            settlement.lastSettled,
            Number(settlement.lastTimestamp),
          );
        }
        if (!cancelled) setData({ state: 'ready', head, settlement, policy, receiptId });
      } catch (err) {
        if (!cancelled) setData({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  if (data.state === 'loading') {
    return <DetailFrame stamp="[ contract ]" title={short(address)} backTo="/explorer"><div className="empty">reading on-chain state…</div></DetailFrame>;
  }
  if (data.state === 'missing') {
    return (
      <DetailFrame stamp="[ contract ]" title={short(address)} backTo="/explorer">
        <div className="empty">no Condition contract state at this address</div>
        <p className="proof-note">The state either does not exist or does not decode as a Condition policy/settlement ledger.</p>
      </DetailFrame>
    );
  }
  if (data.state === 'error') {
    return (
      <DetailFrame stamp="[ contract ]" title={short(address)} backTo="/explorer">
        <div className="empty">indexer unreachable — nothing claimed</div>
        <p className="proof-note">{data.message}</p>
      </DetailFrame>
    );
  }

  const { settlement, policy } = data;
  return (
    <DetailFrame
      stamp="[ contract · live state ]"
      title={settlement ? 'Condition settlement instance' : 'Condition policy instance'}
      backTo="/explorer"
    >
      <dl className="evidence">
        <div className="evidence-row"><dt>address</dt><dd title={address}>{address}</dd></div>
        <div className="evidence-row">
          <dt>on midnight explorer</dt>
          <dd><a className="explorer-link" href={explorerUrl(address)} target="_blank" rel="noreferrer">open ↗</a></dd>
        </div>
        {data.head && (
          <div className="evidence-row">
            <dt>latest action</dt>
            <dd>
              <a className="explorer-link mono-row" href={`/explorer?t=${data.head.txHash}`}>
                {short(data.head.txHash)} · block {data.head.blockHeight.toLocaleString()}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {settlement && (
        <>
          <h2 className="explorer-sub">Public settlement ledger</h2>
          <dl className="evidence">
            <div className="evidence-row"><dt>linked policy</dt><dd><code title={settlement.policyId}>{settlement.policyId}</code></dd></div>
            <div className="evidence-row"><dt>terms digest</dt><dd><code title={settlement.termsDigest}>{short(settlement.termsDigest, 22, 10)}</code></dd></div>
            <div className="evidence-row"><dt>enrollment commitment</dt><dd><code title={settlement.enrollmentCommitment}>{short(settlement.enrollmentCommitment, 22, 10)}</code></dd></div>
            <div className="evidence-row"><dt>escrow payout size</dt><dd>{settlement.payout.toString()} <span className="redacted-note">(face value of the payout parameter — public terms)</span></dd></div>
            <div className="evidence-row"><dt>coverage window</dt><dd className="mono-row">{new Date(Number(settlement.start) * 1000).toISOString()} → {new Date(Number(settlement.expiry) * 1000).toISOString()}</dd></div>
            <div className="evidence-row"><dt>trigger outcome</dt><dd>{settlement.triggerFired ? 'FIRED' : 'NOT FIRED'}</dd></div>
            <div className="evidence-row"><dt>nullifiers spent</dt><dd>{settlement.spentNullifierCount.toString()} <span className="redacted-note">(count public — the nullifiers themselves are one-way)</span></dd></div>
            <div className="evidence-row"><dt>settled / denied</dt><dd>{settlement.settledCount.toString()} / {settlement.deniedCount.toString()}</dd></div>
          </dl>

          <h2 className="explorer-sub">Latest public receipt</h2>
          {data.receiptId ? (
            <dl className="evidence">
              <div className="evidence-row">
                <dt>receipt id</dt>
                <dd>
                  <a className="explorer-link" href={`/verify?receipt=${data.receiptId}&settlement=${address}`}>
                    verify this receipt →
                  </a>
                </dd>
              </div>
              <div className="evidence-row"><dt>receipt id (full)</dt><dd><code title={data.receiptId}>{data.receiptId}</code></dd></div>
              <div className="evidence-row"><dt>proof hash</dt><dd><code title={settlement.lastReceiptHash}>{short(settlement.lastReceiptHash, 22, 10)}</code></dd></div>
              <div className="evidence-row"><dt>status</dt><dd><span className={`status ${settlement.lastSettled ? 'SETTLED' : 'DENIED'}`}>{settlement.lastSettled ? 'SETTLED' : 'DENIED'}</span></dd></div>
              <div className="evidence-row"><dt>timestamp</dt><dd className="mono-row">{new Date(Number(settlement.lastTimestamp) * 1000).toISOString()}</dd></div>
              <div className="evidence-row"><dt>amount paid</dt><dd><span className="redacted">████████</span> <span className="redacted-note">committed, never disclosed</span></dd></div>
              <div className="evidence-row"><dt>claimant</dt><dd><span className="redacted">████████</span> <span className="redacted-note">never on chain</span></dd></div>
            </dl>
          ) : (
            <div className="empty">no settlement published on this instance yet</div>
          )}
        </>
      )}

      {policy && (
        <>
          <h2 className="explorer-sub">Public policy terms (Invariant 5 — fully transparent)</h2>
          <dl className="evidence">
            <div className="evidence-row"><dt>policy id</dt><dd><code title={policy.policyId}>{policy.policyId}</code></dd></div>
            <div className="evidence-row"><dt>trigger</dt><dd>{TRIGGER_NAMES[policy.triggerType] ?? policy.triggerType} {OP_NAMES[policy.operator] ?? policy.operator} {policy.threshold.toString()}</dd></div>
            <div className="evidence-row"><dt>payout parameter</dt><dd>{policy.payout.toString()}</dd></div>
            <div className="evidence-row"><dt>premium</dt><dd>{policy.premium.toString()}</dd></div>
            <div className="evidence-row"><dt>escrow funded</dt><dd>{policy.funded.toString()}</dd></div>
            <div className="evidence-row"><dt>coverage window</dt><dd className="mono-row">{new Date(Number(policy.start) * 1000).toISOString()} → {new Date(Number(policy.expiry) * 1000).toISOString()}</dd></div>
            <div className="evidence-row"><dt>enrolled</dt><dd>{policy.enrolled ? 'yes' : 'no'}</dd></div>
            <div className="evidence-row"><dt>trigger readings</dt><dd className="mono-row">{policy.triggerValue.toString()} observed · sources {short(policy.triggerSource1)} + {short(policy.triggerSource2)}</dd></div>
            <div className="evidence-row"><dt>status</dt><dd>{STATUS_NAMES[policy.status] ?? policy.status}</dd></div>
            <div className="evidence-row"><dt>enrollment commitment</dt><dd><code title={policy.enrollmentCommitment}>{short(policy.enrollmentCommitment, 22, 10)}</code> <span className="redacted-note">H(policyId, secret) — one-way, unlinkable</span></dd></div>
          </dl>
          <p className="proof-note">
            The holder secret behind the commitment never left the holder's
            device. The two source digests above are the public trigger
            evidence; the readings that fed them were recorded on chain at
            record_trigger().
          </p>
        </>
      )}
    </DetailFrame>
  );
}

const TRIGGER_NAMES = ['temperature', 'rainfall_mm', 'flight_delay_min', 'earthquake_mag'];
const OP_NAMES = ['>', '>=', '<', '<=', '=='];
const STATUS_NAMES = ['ACTIVE', 'TRIGGERED', 'SETTLING', 'SETTLED', 'DENIED', 'EXPIRED', 'CLOSED'];

function DetailFrame({ stamp, title, backTo, children }: {
  stamp: string;
  title: string;
  backTo?: string;
  children: ReactNode;
}) {
  return (
    <div className="card stage-card">
      <span className="stamp">{stamp}</span>
      <h1 className="section-title" style={{ fontSize: 'clamp(20px, 3vw, 28px)' }}>{title}</h1>
      {children}
      {backTo && (
        <div className="stage-nav">
          <a className="stage-nav-link" href={backTo}>
            <span className="stage-nav-dir">← back</span>
            <span className="stage-nav-to">explorer</span>
          </a>
          <span />
        </div>
      )}
    </div>
  );
}

function short(hex: string, head = 12, tail = 8): string {
  return hex.length > head + tail + 2 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex;
}
