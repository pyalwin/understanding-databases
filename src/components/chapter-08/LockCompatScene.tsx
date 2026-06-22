import React from 'react';
import { useMemo, useState } from 'react';
import { Figure } from '@/components/scene';

/*
 * LockCompatScene — Chapter 08 §2 (Figure 8.1).
 *
 * The compatibility matrix made interactive. Two transactions (T1, T2) request
 * shared (S) or exclusive (X) locks on ONE item; the 2×2 matrix at the center
 * is the whole rule — S/S compatible, S/X · X/S · X/X conflict. A request that
 * conflicts with what is already granted goes to the wait queue and is woken
 * (FIFO) when the conflict clears on release. The matrix is the focal point:
 * each request lights the cell (held mode × requested mode) that decided it.
 *
 * Mirrors the LOCKS_SANDBOX in lock-sandboxes.ts: granted set + wait queue on a
 * single item, with the same compatible() predicate.
 */

type Mode = 'S' | 'X';
type Txn = 'T1' | 'T2';

const TXNS: Txn[] = ['T1', 'T2'];
const MODES: Mode[] = ['S', 'X'];

const TXN_COLOR: Record<Txn, string> = {
  T1: 'var(--color-fig-blue)',
  T2: 'var(--color-accent)',
};

// The compatibility matrix is the entire policy. Empty holder set → anything is
// compatible; otherwise only shared-with-shared coexists.
function compatible(held: Mode[], want: Mode): boolean {
  if (held.length === 0) return true;
  if (want === 'S' && held.every((m) => m === 'S')) return true;
  return false;
}

// Static truth table for the displayed grid (assumes a single existing holder).
const CELL_OK: Record<Mode, Record<Mode, boolean>> = {
  S: { S: true, X: false },
  X: { S: false, X: false },
};

interface LockState {
  granted: Partial<Record<Txn, Mode>>;
  queue: { txn: Txn; mode: Mode }[];
}

type Outcome = 'granted' | 'waiting' | 'released';

interface LastAction {
  txn: Txn;
  mode: Mode;
  held: Mode | null; // representative held mode (the matrix row), null if free
  outcome: Outcome;
}

const INITIAL: LockState = { granted: {}, queue: [] };

export default function LockCompatScene() {
  const [state, setState] = useState<LockState>(INITIAL);
  const [last, setLast] = useState<LastAction | null>(null);

  const grantedModes = (g: Partial<Record<Txn, Mode>>): Mode[] =>
    TXNS.map((t) => g[t]).filter((m): m is Mode => m !== undefined);

  const heldByOthers = (g: Partial<Record<Txn, Mode>>, txn: Txn): Mode[] =>
    TXNS.filter((t) => t !== txn && g[t]).map((t) => g[t] as Mode);

  const repr = (held: Mode[]): Mode | null =>
    held.length === 0 ? null : held.includes('X') ? 'X' : 'S';

  const statusOf = (txn: Txn): 'idle' | 'granted' | 'waiting' => {
    if (state.granted[txn]) return 'granted';
    if (state.queue.some((q) => q.txn === txn)) return 'waiting';
    return 'idle';
  };

  function request(txn: Txn, mode: Mode) {
    setState((s) => {
      const held = heldByOthers(s.granted, txn);
      if (compatible(held, mode)) {
        setLast({ txn, mode, held: repr(held), outcome: 'granted' });
        return { ...s, granted: { ...s.granted, [txn]: mode } };
      }
      setLast({ txn, mode, held: repr(held), outcome: 'waiting' });
      return { ...s, queue: [...s.queue, { txn, mode }] };
    });
  }

  function release(txn: Txn) {
    setState((s) => {
      const granted = { ...s.granted };
      delete granted[txn];
      let queue = s.queue.filter((q) => q.txn !== txn);
      // Wake from the FRONT while the next waiter is compatible (FIFO — a
      // blocked X is not jumped by a later S).
      while (queue.length > 0 && compatible(grantedModes(granted), queue[0].mode)) {
        const next = queue[0];
        queue = queue.slice(1);
        granted[next.txn] = next.mode;
      }
      setLast({ txn, mode: s.granted[txn] ?? 'S', held: null, outcome: 'released' });
      return { granted, queue };
    });
  }

  function reset() {
    setState(INITIAL);
    setLast(null);
  }

  const held = grantedModes(state.granted);
  const message = useMemo(() => buildMessage(last, state), [last, state]);

  return (
    <Figure
      number="8.1"
      caption={
        <>
          The compatibility matrix is the whole rule. Request locks from{' '}
          <strong>T1</strong> and <strong>T2</strong> on one item:{' '}
          <strong>S</strong> (shared, for reads) coexists with other{' '}
          <strong>S</strong> holders, but <strong>X</strong> (exclusive, for
          writes) conflicts with everything — a conflicting request joins the{' '}
          <em>wait queue</em> and is woken when the holder releases.
        </>
      }
    >
      <div className="lc-wrap">
        {/* The item: granted holders + wait queue */}
        <div className="lc-item">
          <div className="lc-item-head">
            <span className="lc-item-name">
              item <code>balance</code>
            </span>
          </div>
          <div className="lc-slots">
            <div className="lc-slot">
              <span className="lc-slot-label">granted</span>
              <div className="lc-chips">
                {held.length === 0 && <span className="lc-empty">— free —</span>}
                {TXNS.map((t) =>
                  state.granted[t] ? (
                    <span
                      key={t}
                      className="lc-chip"
                      style={{
                        background: TXN_COLOR[t],
                        color: 'var(--color-fig-bg)',
                      }}
                    >
                      {t}:{state.granted[t]}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            <div className="lc-slot">
              <span className="lc-slot-label">wait queue</span>
              <div className="lc-chips">
                {state.queue.length === 0 && <span className="lc-empty">— empty —</span>}
                {state.queue.map((q, i) => (
                  <span
                    key={`${q.txn}-${i}`}
                    className="lc-chip lc-chip-wait"
                    style={{ borderColor: TXN_COLOR[q.txn], color: TXN_COLOR[q.txn] }}
                  >
                    {q.txn}:{q.mode}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* The focal point: the 2×2 compatibility matrix */}
        <div className="lc-matrix-wrap">
          <div className="lc-axis-top">lock requested</div>
          <div className="lc-grid">
            <div className="lc-corner" aria-hidden="true" />
            {MODES.map((m) => (
              <div key={`col-${m}`} className="lc-colhead">
                {m}
              </div>
            ))}
            <div className="lc-axis-left" aria-hidden="true">
              <span>lock held</span>
            </div>
            {MODES.map((rowMode) => (
              <React.Fragment key={`row-${rowMode}`}>
                <div className="lc-rowhead">{rowMode}</div>
                {MODES.map((colMode) => {
                  const ok = CELL_OK[rowMode][colMode];
                  const active =
                    last?.outcome !== 'released' &&
                    last?.held === rowMode &&
                    last?.mode === colMode;
                  return (
                    <div
                      key={`${rowMode}-${colMode}`}
                      className={
                        'lc-cell ' +
                        (ok ? 'lc-ok' : 'lc-no') +
                        (active ? ' lc-active' : '')
                      }
                    >
                      <span className="lc-cell-mark">{ok ? '✓' : '✗'}</span>
                      <span className="lc-cell-word">{ok ? 'grant' : 'wait'}</span>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* What just happened */}
        <div className="lc-message" role="status">
          {message}
        </div>

        {/* Per-transaction request controls */}
        <div className="lc-controls">
          {TXNS.map((t) => {
            const st = statusOf(t);
            return (
              <div key={t} className="lc-panel">
                <div className="lc-panel-head">
                  <span className="lc-panel-name" style={{ color: TXN_COLOR[t] }}>
                    {t}
                  </span>
                  <span className={'lc-status lc-status-' + st}>{st}</span>
                </div>
                <div className="lc-btns">
                  <button
                    type="button"
                    className="fig-btn"
                    onClick={() => request(t, 'S')}
                    disabled={st !== 'idle'}
                  >
                    request S
                  </button>
                  <button
                    type="button"
                    className="fig-btn"
                    onClick={() => request(t, 'X')}
                    disabled={st !== 'idle'}
                  >
                    request X
                  </button>
                  <button
                    type="button"
                    className="fig-btn"
                    onClick={() => release(t)}
                    disabled={st === 'idle'}
                  >
                    release
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="lc-foot">
          <button type="button" className="fig-btn fig-btn-primary" onClick={reset}>
            Reset
          </button>
          <span className="lc-hint">
            Try: T1 request S, T2 request S (both granted) — then T2 release, T1
            request X.
          </span>
        </div>
      </div>

      <style>{`
        .lc-wrap { display: flex; flex-direction: column; gap: 16px; }

        .lc-item {
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px; padding: 11px 13px;
          display: flex; flex-direction: column; gap: 9px;
        }
        .lc-item-name {
          font-family: var(--font-sans); font-size: 12px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .lc-item-name code {
          font-family: var(--font-mono, monospace); font-size: 11.5px;
          background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 3px;
        }
        .lc-slots { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .lc-slot { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
        .lc-slot-label {
          font-family: var(--font-sans); font-size: 9.5px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-fig-muted);
        }
        .lc-chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; min-height: 22px; }
        .lc-chip {
          font-family: var(--font-mono, monospace); font-size: 11px; font-weight: 600;
          padding: 2px 7px; border-radius: 999px; white-space: nowrap;
        }
        .lc-chip-wait {
          background: var(--color-fig-bg); border: 1px dashed currentColor;
        }
        .lc-empty {
          font-family: var(--font-sans); font-size: 11px; font-style: italic;
          color: var(--color-fig-muted);
        }

        .lc-matrix-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        .lc-axis-top {
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-fig-muted);
        }
        .lc-grid {
          display: grid;
          grid-template-columns: 26px 1fr 1fr;
          grid-template-rows: auto 1fr 1fr;
          gap: 7px;
          width: 100%; max-width: 320px;
        }
        .lc-corner { }
        .lc-colhead, .lc-rowhead {
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-mono, monospace); font-size: 15px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .lc-colhead { padding-bottom: 1px; }
        .lc-axis-left {
          grid-row: 2 / 4; grid-column: 1;
          display: flex; align-items: center; justify-content: center;
        }
        .lc-axis-left span {
          writing-mode: vertical-rl; transform: rotate(180deg);
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-fig-muted);
        }
        .lc-cell {
          aspect-ratio: 1 / 1;
          border-radius: 10px; border: 1.5px solid rgba(0,0,0,0.12);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 2px;
          transition: box-shadow 200ms ease, transform 200ms ease, border-color 200ms ease;
        }
        .lc-cell-mark { font-size: 22px; line-height: 1; font-weight: 700; }
        .lc-cell-word {
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .lc-ok {
          background: rgba(47, 107, 58, 0.12); border-color: rgba(47, 107, 58, 0.30);
          color: var(--color-fig-green);
        }
        .lc-no {
          background: rgba(176, 74, 20, 0.12); border-color: rgba(176, 74, 20, 0.30);
          color: var(--color-fig-orange);
        }
        .lc-active {
          transform: translateY(-2px);
          box-shadow: 0 0 0 3px currentColor;
        }

        .lc-message {
          font-family: var(--font-sans); font-size: 12px; line-height: 1.4;
          color: var(--color-fig-fg); text-align: center;
          min-height: 2.4em; display: flex; align-items: center; justify-content: center;
          padding: 0 4px;
        }

        .lc-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .lc-panel {
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px; padding: 10px 11px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .lc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .lc-panel-name {
          font-family: var(--font-mono, monospace); font-size: 14px; font-weight: 700;
        }
        .lc-status {
          font-family: var(--font-sans); font-size: 9.5px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          padding: 2px 7px; border-radius: 999px;
        }
        .lc-status-idle { color: var(--color-fig-muted); background: rgba(0,0,0,0.05); }
        .lc-status-granted { color: var(--color-fig-green); background: rgba(47, 107, 58, 0.14); }
        .lc-status-waiting { color: var(--color-fig-orange); background: rgba(176, 74, 20, 0.14); }
        .lc-btns { display: flex; flex-wrap: wrap; gap: 6px; }
        .lc-btns .fig-btn { font-size: 11px; padding: 4px 9px; }

        .lc-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
        .lc-hint {
          font-family: var(--font-sans); font-size: 11px; line-height: 1.35;
          color: var(--color-fig-muted); flex: 1; min-width: 160px;
        }

        @media (max-width: 440px) {
          .lc-slots { grid-template-columns: 1fr; gap: 8px; }
          .lc-controls { grid-template-columns: 1fr; }
          .lc-grid { max-width: 100%; }
        }
      `}</style>
    </Figure>
  );
}

function buildMessage(last: LastAction | null, state: LockState): React.ReactNode {
  if (!last) {
    return 'Request a lock from T1 or T2 — the matrix cell that decides it lights up.';
  }
  if (last.outcome === 'granted') {
    const free = last.held === null;
    return (
      <span>
        <strong>{last.txn}</strong> requested <strong>{last.mode}</strong> —{' '}
        <span style={{ color: 'var(--color-fig-green)' }}>granted</span>
        {free ? ' (item was free).' : ` (held=${last.held}, ${last.held}/${last.mode} compatible).`}
      </span>
    );
  }
  if (last.outcome === 'waiting') {
    return (
      <span>
        <strong>{last.txn}</strong> requested <strong>{last.mode}</strong> —{' '}
        <span style={{ color: 'var(--color-fig-orange)' }}>conflict</span> with{' '}
        held {last.held}; it <strong>waits</strong> in the queue.
      </span>
    );
  }
  // released
  const woke = state.queue.length === 0 && Object.keys(state.granted).length > 0;
  return (
    <span>
      <strong>{last.txn}</strong> released its lock.
      {woke ? ' A waiter woke from the queue and was granted.' : ''}
    </span>
  );
}
