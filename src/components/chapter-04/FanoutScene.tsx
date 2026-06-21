import React from 'react';
import { useState } from 'react';
import { Figure, Slider } from '@/components/scene';

/* Row-count is a log-scale control: each stop is a 10x step so a single
 * slider spans 100 rows to 10 billion without losing fine control at the
 * low end. The slider value is the index into this array. */
const ROW_STOPS = [
  100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000,
  1_000_000_000, 10_000_000_000,
] as const;

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function compactRows(n: number): string {
  if (n >= 1_000_000_000) return `${round1(n / 1_000_000_000)} billion`;
  if (n >= 1_000_000) return `${round1(n / 1_000_000)} million`;
  if (n >= 1_000) return `${round1(n / 1_000)} thousand`;
  return `${n}`;
}

/** Levels of a tree (leaf included) needed to address `rows` with `fanout`
 * children per node: h = ceil(log_fanout(rows)). Each level is one page read,
 * so height == worst-case IO. */
function treeHeight(rows: number, fanout: number): number {
  const f = Math.max(2, fanout);
  if (rows <= f) return 1;
  return Math.ceil(Math.log(rows) / Math.log(f));
}

/** Build the rows of the schematic pyramid, collapsing the middle when the
 * tree is very tall (binary trees) so the explosion stays legible. */
function pyramidRows(height: number): Array<{ kind: 'level'; index: number } | { kind: 'gap'; hidden: number }> {
  const MAX_SHOWN = 9;
  if (height <= MAX_SHOWN) {
    return Array.from({ length: height }, (_, i) => ({ kind: 'level' as const, index: i }));
  }
  // Show the top 4 levels, a collapse marker, and the bottom 3 (incl. leaf).
  const topCount = 4;
  const bottomCount = 3;
  const hidden = height - topCount - bottomCount;
  const rows: Array<{ kind: 'level'; index: number } | { kind: 'gap'; hidden: number }> = [];
  for (let i = 0; i < topCount; i++) rows.push({ kind: 'level', index: i });
  rows.push({ kind: 'gap', hidden });
  for (let i = height - bottomCount; i < height; i++) rows.push({ kind: 'level', index: i });
  return rows;
}

export default function FanoutScene() {
  const [fanout, setFanout] = useState(400);
  const [rowIdx, setRowIdx] = useState(4); // 1,000,000 by default
  const rows = ROW_STOPS[rowIdx];

  const height = treeHeight(rows, fanout);
  const reach = Math.pow(fanout, height); // rows this height *could* address
  const pyr = pyramidRows(height);
  const exploded = fanout <= 3;

  return (
    <Figure
      number="4.4"
      caption={
        <>
          Tree height is <code>log<sub>fanout</sub>(rows)</code>, and height{' '}
          <em>is</em> the worst-case page reads — one per level. Crank fan-out down
          toward a binary tree and watch the height explode.
        </>
      }
    >
      <div className="fan-wrap">
        {/* Controls */}
        <div className="fan-controls">
          <Slider
            label="keys per node (fan-out)"
            min={2}
            max={500}
            step={1}
            value={fanout}
            onChange={setFanout}
          />
          <label className="fan-rowslider">
            <span className="fan-rowslider-label">rows in the table</span>
            <input
              type="range"
              min={0}
              max={ROW_STOPS.length - 1}
              step={1}
              value={rowIdx}
              onChange={(e) => setRowIdx(Number(e.target.value))}
              aria-label="rows in the table"
            />
            <span className="fan-rowslider-val tabular-nums">
              {rows.toLocaleString('en-US')}
            </span>
          </label>
        </div>

        {/* Focal numbers */}
        <div className="fan-stats">
          <div className="fan-stat">
            <div className="fan-stat-num" style={{ color: exploded ? 'var(--color-fig-red)' : 'var(--color-fig-fg)' }}>
              {height}
            </div>
            <div className="fan-stat-label">tree height (levels)</div>
          </div>
          <div className="fan-stat">
            <div className="fan-stat-num" style={{ color: exploded ? 'var(--color-fig-red)' : 'var(--color-fig-blue)' }}>
              {height}
            </div>
            <div className="fan-stat-label">worst-case page reads</div>
          </div>
          <div className="fan-stat">
            <div className="fan-stat-num">{compactRows(rows)}</div>
            <div className="fan-stat-label">rows addressed</div>
          </div>
        </div>

        {/* Schematic pyramid */}
        <div className="fan-pyramid" role="img" aria-label={`A ${height}-level tree with fan-out ${fanout} addressing ${rows.toLocaleString('en-US')} rows`}>
          {pyr.map((r, i) => {
            if (r.kind === 'gap') {
              return (
                <div key={`gap-${i}`} className="fan-gap">
                  ⋮ <span>{r.hidden} more level{r.hidden === 1 ? '' : 's'}</span>
                </div>
              );
            }
            const isLeaf = r.index === height - 1;
            const isRoot = r.index === 0;
            // Width grows toward the leaves to form a pyramid.
            const frac = height === 1 ? 1 : (r.index + 1) / height;
            const widthPct = 22 + frac * 78; // 22%..100%
            return (
              <div key={`lvl-${r.index}`} className="fan-level-row">
                <span className="fan-level-tag">
                  {isRoot ? 'root' : isLeaf ? 'leaves' : `L${r.index}`}
                </span>
                <div
                  className="fan-bar"
                  style={{
                    width: `${widthPct}%`,
                    background: isLeaf
                      ? 'var(--color-fig-blue)'
                      : 'rgba(30, 79, 165, 0.16)',
                    borderColor: isLeaf ? 'var(--color-fig-blue)' : 'rgba(30, 79, 165, 0.35)',
                    color: isLeaf ? '#fff' : 'var(--color-fig-fg)',
                  }}
                >
                  {isLeaf ? `${rows.toLocaleString('en-US')} rows` : ''}
                </div>
              </div>
            );
          })}
        </div>

        <p className="fan-foot">
          A tree this shape can address up to{' '}
          <strong>
            {fanout}
            <sup>{height}</sup> ={' '}
            {reach >= 1e15 ? '10¹⁵+' : compactRows(Math.round(reach))}
          </strong>{' '}
          rows. With fan-out ~400, three levels already covers tens of millions;
          four covers billions.
        </p>
      </div>

      <style>{`
        .fan-wrap { display: flex; flex-direction: column; gap: 20px; }
        .fan-controls { display: flex; flex-direction: column; gap: 12px; }
        .fan-rowslider {
          display: inline-flex; align-items: center; gap: 8px; width: 100%;
          font-family: var(--font-sans); font-size: 12px; color: var(--color-fig-fg);
        }
        .fan-rowslider-label { white-space: nowrap; }
        .fan-rowslider input[type="range"] { flex: 1; }
        .fan-rowslider-val {
          width: 92px; text-align: right; color: var(--color-fig-muted);
          font-variant-numeric: tabular-nums;
        }

        .fan-stats {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
        }
        .fan-stat {
          text-align: center; padding: 14px 6px; border-radius: 10px;
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
        }
        .fan-stat-num {
          font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif;
          font-size: 2.4rem; font-weight: 600; line-height: 1;
          font-variant-numeric: tabular-nums;
        }
        .fan-stat-label {
          font-family: var(--font-sans); font-size: 10.5px; font-weight: 600;
          letter-spacing: 0.05em; text-transform: uppercase;
          color: var(--color-fig-muted); margin-top: 8px; line-height: 1.3;
        }

        .fan-pyramid {
          display: flex; flex-direction: column; gap: 6px; align-items: stretch;
          padding: 4px 0;
        }
        .fan-level-row { display: flex; align-items: center; gap: 8px; }
        .fan-level-tag {
          width: 46px; flex-shrink: 0; text-align: right;
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          color: var(--color-fig-muted);
        }
        .fan-bar {
          height: 26px; border-radius: 6px; border: 1px solid;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-sans); font-size: 11.5px; font-weight: 600;
          transition: width 220ms ease, background 220ms ease;
          margin: 0 auto; min-width: 40px;
        }
        .fan-gap {
          text-align: center; font-family: var(--font-sans); font-size: 12px;
          color: var(--color-fig-red); font-weight: 600; padding: 2px 0;
          letter-spacing: 0.06em;
        }
        .fan-gap span { font-weight: 500; }

        .fan-foot {
          font-family: var(--font-sans); font-size: 12.5px; line-height: 1.5;
          color: var(--color-fig-muted); margin: 0;
        }
        .fan-foot strong { color: var(--color-fig-fg); font-variant-numeric: tabular-nums; }

        @media (max-width: 520px) {
          .fan-stats { gap: 6px; }
          .fan-stat { padding: 12px 2px; }
          .fan-stat-num { font-size: 1.9rem; }
          .fan-stat-label { font-size: 9px; }
          .fan-rowslider-val { width: 100px; font-size: 10px; }
          .fan-level-tag { width: 38px; font-size: 9px; }
        }
      `}</style>
    </Figure>
  );
}
