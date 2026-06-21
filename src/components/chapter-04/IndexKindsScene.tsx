import React from 'react';
import { useEffect, useState } from 'react';
import { Figure, Callout } from '@/components/scene';

/* Each diagram is an ordered list of "stops" the lookup touches. A single
 * global step counter advances through both at once so the reader can watch
 * the clustered side finish at the leaf while the secondary side keeps going
 * for the extra heap hop. */
type NodeKind = 'root' | 'branch' | 'leaf' | 'heap';

interface PathNode {
  kind: NodeKind;
  title: string;
  sub: string;
}

const CLUSTERED: PathNode[] = [
  { kind: 'root', title: 'root', sub: 'route by key' },
  { kind: 'branch', title: 'branch', sub: 'narrow the range' },
  { kind: 'leaf', title: 'leaf = the row', sub: 'id 42 · owner · balance' },
];

const SECONDARY_HEAP: PathNode[] = [
  { kind: 'root', title: 'root', sub: 'route by key' },
  { kind: 'branch', title: 'branch', sub: 'narrow the range' },
  { kind: 'leaf', title: 'leaf', sub: 'id 42 → row-id' },
  { kind: 'heap', title: 'heap fetch', sub: 'follow row-id → full row' },
];

const SECONDARY_COVERING: PathNode[] = [
  { kind: 'root', title: 'root', sub: 'route by key' },
  { kind: 'branch', title: 'branch', sub: 'narrow the range' },
  { kind: 'leaf', title: 'leaf covers it', sub: 'id 42 + balance' },
];

function Column({
  heading,
  tag,
  tagColor,
  path,
  step,
  result,
}: {
  heading: string;
  tag: string;
  tagColor: string;
  path: PathNode[];
  step: number;
  result: string;
}) {
  const lastIdx = path.length - 1;
  const done = step >= lastIdx;
  return (
    <div className="ik-col">
      <div className="ik-col-head">
        <span className="ik-col-title">{heading}</span>
        <span className="ik-col-tag" style={{ background: tagColor }}>
          {tag}
        </span>
      </div>
      <div className="ik-path">
        {path.map((n, i) => {
          const active = i === step;
          const visited = i < step;
          const isHop = n.kind === 'heap';
          return (
            <React.Fragment key={i}>
              {i > 0 && (
                <div
                  className={'ik-arrow' + (isHop ? ' ik-arrow-hop' : '')}
                  aria-hidden="true"
                >
                  {isHop ? '↓ hop' : '↓'}
                </div>
              )}
              <div
                className={
                  'ik-node ik-node-' +
                  n.kind +
                  (active ? ' ik-active' : '') +
                  (visited ? ' ik-visited' : '')
                }
              >
                <div className="ik-node-title">{n.title}</div>
                <div className="ik-node-sub">{n.sub}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className={'ik-result' + (done ? ' ik-result-on' : '')}>
        {done ? result : ' '}
      </div>
    </div>
  );
}

export default function IndexKindsScene() {
  const [covering, setCovering] = useState(false);
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);

  const secondary = covering ? SECONDARY_COVERING : SECONDARY_HEAP;
  const maxIdx = Math.max(CLUSTERED.length, secondary.length) - 1;

  // Drive the animation one stop at a time.
  useEffect(() => {
    if (!running) return;
    if (step >= maxIdx) {
      setRunning(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [running, step, maxIdx]);

  const run = () => {
    setStep(0);
    setRunning(true);
  };
  const reset = () => {
    setRunning(false);
    setStep(-1);
  };

  // Reset the walk whenever the covering toggle flips.
  useEffect(() => {
    setRunning(false);
    setStep(-1);
  }, [covering]);

  return (
    <Figure
      number="4.5"
      caption={
        <>
          Same query, two index designs. A <strong>clustered</strong> index ends
          at the leaf — the leaf <em>is</em> the row. A <strong>secondary</strong>{' '}
          index ends with a hop back to the heap, unless it <em>covers</em> the
          query.
        </>
      }
    >
      <div className="ik-wrap">
        {/* Controls */}
        <div className="ik-controls">
          <button type="button" className="fig-btn fig-btn-primary" onClick={run} disabled={running}>
            ▶ Run the same lookup
          </button>
          <button type="button" className="fig-btn" onClick={reset} disabled={step === -1}>
            Reset
          </button>
          <label className="ik-toggle">
            <input
              type="checkbox"
              checked={covering}
              onChange={(e) => setCovering(e.target.checked)}
            />
            <span>covering index (put <code>balance</code> in the index)</span>
          </label>
        </div>

        {/* Two diagrams */}
        <div className="ik-cols">
          <Column
            heading="Clustered"
            tag="leaf = row"
            tagColor="rgba(47, 107, 58, 0.18)"
            path={CLUSTERED}
            step={step}
            result="✓ one descent — done at the leaf"
          />
          <Column
            heading="Secondary"
            tag={covering ? 'covering' : 'leaf → heap'}
            tagColor="rgba(176, 74, 20, 0.18)"
            path={secondary}
            step={step}
            result={
              covering
                ? '✓ descent only — hop skipped'
                : '✓ descent + 1 heap hop'
            }
          />
        </div>

        <Callout type="note" title="Which engines do what">
          In <strong>SQLite</strong> and <strong>PostgreSQL</strong>, the table is a
          heap and every index is secondary by default — point lookups pay the hop
          unless the index covers the query. In <strong>MySQL/InnoDB</strong>, the
          table <em>is</em> a clustered index on the primary key, so a PK lookup ends
          at the leaf, while every secondary index stores the PK and hops through the
          clustered index to reach the row.
        </Callout>
      </div>

      <style>{`
        .ik-wrap { display: flex; flex-direction: column; gap: 18px; }
        .ik-controls {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        }
        .ik-toggle {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: var(--font-sans); font-size: 12px; color: var(--color-fig-fg);
          cursor: pointer;
        }
        .ik-toggle code {
          font-family: var(--font-mono, monospace); font-size: 11px;
          background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px;
        }

        .ik-cols {
          display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
          align-items: start;
        }
        .ik-col {
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px; padding: 14px 12px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .ik-col-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .ik-col-title {
          font-family: var(--font-sans); font-size: 13px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .ik-col-tag {
          font-family: var(--font-sans); font-size: 9.5px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--color-fig-fg); padding: 2px 7px; border-radius: 999px;
          white-space: nowrap;
        }

        .ik-path { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .ik-node {
          width: 100%; border-radius: 8px; border: 1px solid rgba(0,0,0,0.12);
          background: var(--color-fig-bg); padding: 8px 9px; text-align: center;
          transition: background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
        }
        .ik-node-title {
          font-family: var(--font-sans); font-size: 12px; font-weight: 600;
          color: var(--color-fig-fg); line-height: 1.25;
        }
        .ik-node-sub {
          font-family: var(--font-mono, monospace); font-size: 10.5px;
          color: var(--color-fig-muted); margin-top: 2px; line-height: 1.3;
        }
        .ik-node-heap { border-style: dashed; }
        .ik-visited {
          background: rgba(30, 79, 165, 0.07); border-color: rgba(30, 79, 165, 0.25);
        }
        .ik-active {
          background: rgba(30, 79, 165, 0.16); border-color: var(--color-fig-blue);
          box-shadow: 0 0 0 2px rgba(30, 79, 165, 0.25); transform: translateY(-1px);
        }
        .ik-node-heap.ik-active, .ik-node-heap.ik-visited {
          background: rgba(176, 74, 20, 0.14); border-color: var(--color-fig-orange);
          box-shadow: 0 0 0 2px rgba(176, 74, 20, 0.22);
        }

        .ik-arrow {
          font-family: var(--font-sans); font-size: 11px; color: var(--color-fig-muted);
          line-height: 1.1; padding: 1px 0;
        }
        .ik-arrow-hop { color: var(--color-fig-orange); font-weight: 600; font-size: 10px; letter-spacing: 0.04em; }

        .ik-result {
          font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
          text-align: center; min-height: 1.2em; color: var(--color-fig-green);
          opacity: 0; transition: opacity 200ms ease;
        }
        .ik-result-on { opacity: 1; }

        @media (max-width: 720px) {
          .ik-cols { grid-template-columns: 1fr; gap: 12px; }
        }
        @media (max-width: 520px) {
          .ik-controls { gap: 8px; }
          .ik-toggle { font-size: 11.5px; }
        }
      `}</style>
    </Figure>
  );
}
