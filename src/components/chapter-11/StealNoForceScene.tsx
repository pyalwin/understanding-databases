import React from 'react';
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Toggle } from '@/components/scene';

/*
 * StealNoForceScene — Chapter 11 §2 (Figure 11.1).
 *
 * The 2×2 buffer-policy matrix that DEFINES why ARIES needs both passes:
 * steal / no-steal (rows) × force / no-force (columns). Each policy decides
 * what a crash can leave on disk, and therefore which recovery work is needed:
 *
 *   no-force  -> a COMMITTED change may not be on disk yet   -> need REDO
 *   steal     -> an UNCOMMITTED change may already be on disk -> need UNDO
 *
 * So the requirement per cell is purely:
 *   needsRedo = !force      needsUndo = steal
 *
 * The four cells: no-steal+force (neither — but slowest), no-steal+no-force
 * (redo only), steal+force (undo only), steal+no-force (BOTH — the full ARIES
 * machinery). We land on steal+no-force because that is the fastest policy and
 * exactly what ch05's buffer pool already does: it STEALS frames (evicts dirty
 * uncommitted pages) and does NOT force (won't flush at commit). Performance up
 * front; redo + undo is the bill that comes due at recovery.
 *
 * Interactive: flip the two policy toggles (or click a cell); the redo/undo
 * requirement lights up live. Cream palette only. Reflows at 390px — the matrix
 * scales to width and the controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const ORANGE = 'var(--color-fig-orange)';
const RED = 'var(--color-fig-red)';
const MUTED = 'var(--color-fig-muted)';

interface CellInfo {
  needsRedo: boolean;
  needsUndo: boolean;
  label: string;
  color: string;
}

function cellInfo(steal: boolean, force: boolean): CellInfo {
  const needsRedo = !force; // no-force -> committed change may be missing
  const needsUndo = steal; //  steal    -> uncommitted change may be on disk
  let label: string;
  let color: string;
  if (needsRedo && needsUndo) {
    label = 'REDO + UNDO';
    color = RED;
  } else if (needsRedo) {
    label = 'REDO only';
    color = ORANGE;
  } else if (needsUndo) {
    label = 'UNDO only';
    color = ORANGE;
  } else {
    label = 'neither';
    color = GREEN;
  }
  return { needsRedo, needsUndo, label, color };
}

// Rows = steal policy, Columns = force policy.
const ROWS = [
  { steal: true, name: 'steal', sub: 'may evict a dirty uncommitted page' },
  { steal: false, name: 'no-steal', sub: 'pin dirty pages until commit' },
];
const COLS = [
  { force: true, name: 'force', sub: 'flush all pages at commit' },
  { force: false, name: 'no-force', sub: "don't flush at commit" },
];

export default function StealNoForceScene() {
  // Default to the policy real engines (and ch05's buffer pool) actually use.
  const [steal, setSteal] = useState(true);
  const [force, setForce] = useState(false);

  const cur = useMemo(() => cellInfo(steal, force), [steal, force]);
  const landed = steal && !force;

  return (
    <Figure
      number="11.1"
      caption={
        <>
          The buffer-pool policy decides the recovery bill.{' '}
          <strong>No-force</strong> means a committed change may not be on disk
          yet — so recovery must <strong>redo</strong> it. <strong>Steal</strong>{' '}
          means an uncommitted change may already be on disk — so recovery must{' '}
          <strong>undo</strong> it. Flip the two policies and watch the
          requirement light up. Real engines (and Chapter 05's buffer pool) pick{' '}
          <strong>steal + no-force</strong> — the fastest policy, and the one that
          needs the full ARIES machinery.
        </>
      }
    >
      <div className="snf-wrap">
        {/* policy toggles */}
        <div className="snf-toggles">
          <div className="snf-toggle-card">
            <Toggle label="steal" value={steal} onChange={setSteal} />
            <span className="snf-toggle-sub">
              {steal
                ? 'buffer pool may flush an uncommitted page'
                : 'never flush an uncommitted page'}
            </span>
          </div>
          <div className="snf-toggle-card">
            <Toggle label="force" value={force} onChange={setForce} />
            <span className="snf-toggle-sub">
              {force
                ? 'flush every page of a txn at commit'
                : "don't flush at commit (no-force)"}
            </span>
          </div>
        </div>

        {/* the 2×2 matrix */}
        <div className="snf-matrix-scroll">
          <div className="snf-axis-top">force policy →</div>
          <div className="snf-grid">
            <div className="snf-corner" aria-hidden="true" />
            {COLS.map((c) => (
              <div key={c.name} className="snf-colhead">
                <span className="snf-head-name">{c.name}</span>
                <span className="snf-head-sub">{c.sub}</span>
              </div>
            ))}

            {ROWS.map((row) => (
              <React.Fragment key={row.name}>
                <div className="snf-rowhead">
                  <span className="snf-head-name">{row.name}</span>
                  <span className="snf-head-sub">{row.sub}</span>
                </div>
                {COLS.map((col) => {
                  const info = cellInfo(row.steal, col.force);
                  const active = row.steal === steal && col.force === force;
                  const isLanding = row.steal && !col.force;
                  return (
                    <motion.button
                      type="button"
                      key={col.name}
                      onClick={() => {
                        setSteal(row.steal);
                        setForce(col.force);
                      }}
                      aria-pressed={active}
                      className="snf-cell"
                      animate={{
                        scale: active ? 1 : 1,
                        boxShadow: active
                          ? `0 0 0 3px ${info.color}`
                          : '0 0 0 0px rgba(0,0,0,0)',
                      }}
                      transition={{ duration: 0.25 }}
                      style={{
                        background: `${info.color}14`,
                        borderColor: `${info.color}55`,
                      }}
                    >
                      <div className="snf-cell-reqs">
                        <span
                          className="snf-pill"
                          style={{
                            color: info.needsRedo ? ORANGE : MUTED,
                            borderColor: info.needsRedo ? ORANGE : 'rgba(0,0,0,0.14)',
                            opacity: info.needsRedo ? 1 : 0.45,
                          }}
                        >
                          REDO
                        </span>
                        <span
                          className="snf-pill"
                          style={{
                            color: info.needsUndo ? ORANGE : MUTED,
                            borderColor: info.needsUndo ? ORANGE : 'rgba(0,0,0,0.14)',
                            opacity: info.needsUndo ? 1 : 0.45,
                          }}
                        >
                          UNDO
                        </span>
                      </div>
                      <span className="snf-cell-label" style={{ color: info.color }}>
                        {info.label}
                      </span>
                      {isLanding && (
                        <span className="snf-cell-tag">what real engines do</span>
                      )}
                    </motion.button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* live explanation of the selected policy */}
        <div
          className="snf-explain"
          role="status"
          aria-live="polite"
          style={{ borderColor: `${cur.color}66` }}
        >
          <div className="snf-explain-head">
            <span className="snf-explain-policy">
              {steal ? 'steal' : 'no-steal'} + {force ? 'force' : 'no-force'}
            </span>
            <span className="snf-explain-req" style={{ color: cur.color }}>
              needs {cur.label}
            </span>
          </div>
          <div className="snf-explain-body">
            <p>
              <strong style={{ color: cur.needsRedo ? ORANGE : GREEN }}>
                {cur.needsRedo ? 'REDO needed' : 'no redo'}
              </strong>{' '}
              —{' '}
              {force
                ? 'force flushes every page at commit, so a committed change is always on disk.'
                : "no-force leaves committed pages in memory, so a crash can lose them — recovery replays the log forward to restore them."}
            </p>
            <p>
              <strong style={{ color: cur.needsUndo ? ORANGE : GREEN }}>
                {cur.needsUndo ? 'UNDO needed' : 'no undo'}
              </strong>{' '}
              —{' '}
              {steal
                ? 'steal lets the pool flush a dirty uncommitted page, so a crash can leave half-done work on disk — recovery rolls it back along the prevLSN chain.'
                : 'no-steal never writes an uncommitted page, so disk never holds work that must be reversed.'}
            </p>
          </div>
          {landed ? (
            <div className="snf-land" style={{ borderColor: `${RED}66` }}>
              This is the policy Chapter 05's buffer pool already runs: it{' '}
              <strong>steals</strong> frames (evicts dirty uncommitted pages to
              make room) and does <strong>not force</strong> (commit is just a log
              write, no page flush). Fastest at runtime — and the reason ARIES
              must carry <strong>both</strong> redo and undo.
            </div>
          ) : (
            <div className="snf-land snf-land-muted">
              {!steal && force
                ? 'Simplest to recover (nothing to do) — but no-steal pins memory and force makes every commit pay a flush. Real systems refuse this tax.'
                : 'A half-measure: cheaper recovery, but it still constrains the buffer pool. Try steal + no-force to see the policy real engines actually choose.'}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .snf-wrap { display: flex; flex-direction: column; gap: 16px; }

        .snf-toggles { display: flex; flex-wrap: wrap; gap: 10px; }
        .snf-toggle-card {
          flex: 1; min-width: 150px;
          display: flex; flex-direction: column; gap: 6px;
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px; padding: 10px 12px; min-height: 38px;
        }
        .snf-toggle-sub {
          font-family: var(--font-sans); font-size: 11px; line-height: 1.35;
          color: var(--color-fig-muted);
        }

        .snf-matrix-scroll {
          overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;
          display: flex; flex-direction: column; align-items: center; gap: 5px;
        }
        .snf-axis-top {
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--color-fig-muted); align-self: center;
        }
        .snf-grid {
          display: grid;
          grid-template-columns: minmax(96px, 1.1fr) 1fr 1fr;
          gap: 8px;
          width: 100%; max-width: 440px; min-width: 320px;
        }
        .snf-corner { }
        .snf-colhead, .snf-rowhead {
          display: flex; flex-direction: column; gap: 1px; justify-content: center;
          padding: 4px 2px;
        }
        .snf-colhead { align-items: center; text-align: center; }
        .snf-rowhead { align-items: flex-start; text-align: left; }
        .snf-head-name {
          font-family: var(--font-mono, monospace); font-size: 13.5px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .snf-head-sub {
          font-family: var(--font-sans); font-size: 9.5px; line-height: 1.25;
          color: var(--color-fig-muted);
        }

        .snf-cell {
          position: relative;
          aspect-ratio: 1 / 1; min-height: 88px;
          border-radius: 12px; border: 1.5px solid;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 8px; cursor: pointer; padding: 6px;
          font: inherit; text-align: center;
          transition: background-color 200ms ease, border-color 200ms ease;
        }
        .snf-cell-reqs { display: flex; gap: 5px; }
        .snf-pill {
          font-family: var(--font-mono, monospace); font-size: 10px; font-weight: 700;
          letter-spacing: 0.03em;
          padding: 1px 6px; border-radius: 999px; border: 1px solid;
          background: var(--color-fig-bg);
          transition: opacity 200ms ease, color 200ms ease, border-color 200ms ease;
        }
        .snf-cell-label {
          font-family: var(--font-sans); font-size: 12px; font-weight: 700;
          letter-spacing: 0.01em;
        }
        .snf-cell-tag {
          position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%);
          white-space: nowrap;
          font-family: var(--font-sans); font-size: 8.5px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--color-fig-red);
        }

        .snf-explain {
          background: rgba(0,0,0,0.025); border: 1.5px solid;
          border-radius: 10px; padding: 12px 13px;
          display: flex; flex-direction: column; gap: 9px;
        }
        .snf-explain-head {
          display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
        }
        .snf-explain-policy {
          font-family: var(--font-mono, monospace); font-size: 14px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .snf-explain-req {
          font-family: var(--font-sans); font-size: 12px; font-weight: 700;
        }
        .snf-explain-body { display: flex; flex-direction: column; gap: 6px; }
        .snf-explain-body p {
          margin: 0;
          font-family: var(--font-sans); font-size: 12px; line-height: 1.45;
          color: var(--color-fig-fg);
        }
        .snf-land {
          font-family: var(--font-sans); font-size: 11.5px; line-height: 1.45;
          color: var(--color-fig-fg);
          background: var(--color-fig-bg); border: 1px solid;
          border-radius: 8px; padding: 8px 10px;
        }
        .snf-land-muted {
          color: var(--color-fig-muted); border-color: rgba(0,0,0,0.12) !important;
        }

        @media (max-width: 440px) {
          .snf-grid { max-width: 100%; }
          .snf-cell { min-height: 80px; }
          .snf-head-sub { display: none; }
        }
      `}</style>
    </Figure>
  );
}
