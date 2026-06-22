import React from 'react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * CardinalityScene — chapter 07 §3 (HERO). Figure 7.3.
 *
 * The central, hardest problem in the optimizer: estimating how many rows each
 * operator emits, before a single row is read. Two acts, one figure:
 *
 *   ① Read a predicate's selectivity off a histogram. The reader drags a
 *      threshold (age > x); the estimate is read off the histogram under the
 *      uniform-within-bucket assumption, and shown against the TRUE count. The
 *      single-predicate error is small — histograms are exact at bucket edges,
 *      approximate inside.
 *
 *   ② Chain joins and watch the estimate diverge from reality. Each join the
 *      estimator assumes independence; correlation it misses makes more rows
 *      survive than predicted, and the error MULTIPLIES per join. A 2x miss per
 *      join becomes 16x over four — the estimate is a sliver of the truth.
 *
 * 390px: single column throughout. Histogram is full-width vertical bars;
 * readouts are a 2-col grid that holds at 390; the join section stacks a button
 * row, a slider, a big error-factor readout, and two comparison bars.
 */

const BUCKETS = 8;
const WIDTH = 10; // equi-width buckets of 10 years over [0, 80)
const AGE_MAX = BUCKETS * WIDTH;

/* Per-year counts, generated deterministically (a two-bump age distribution)
 * so SSR and client agree. The histogram is the decade-sums of these, and the
 * "true" count is the exact sum above the threshold — so the only error in act
 * ① is the uniform-within-bucket assumption, exactly like a real optimizer. */
function gauss(a: number, mu: number, sigma: number): number {
  return Math.exp(-((a - mu) ** 2) / (2 * sigma * sigma));
}
const YEAR_COUNTS: number[] = Array.from({ length: AGE_MAX }, (_, a) =>
  Math.round(300 * gauss(a, 32, 11) + 88 * gauss(a, 60, 8)),
);
const HIST: number[] = Array.from({ length: BUCKETS }, (_, b) =>
  YEAR_COUNTS.slice(b * WIDTH, b * WIDTH + WIDTH).reduce((s, c) => s + c, 0),
);
const N = HIST.reduce((s, c) => s + c, 0);
const HIST_MAX = Math.max(...HIST);

/** Rows passing (age > x), read off the histogram: full buckets above x plus
 *  the uniform-within-bucket fraction of the bucket holding x. */
function estimateRowsGt(x: number): number {
  let rows = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const lo = b * WIDTH;
    const hi = lo + WIDTH;
    if (lo >= x) rows += HIST[b];
    else if (hi > x) rows += (HIST[b] * (hi - x)) / WIDTH;
  }
  return rows;
}
/** The true count from the underlying data. */
function trueRowsGt(x: number): number {
  let rows = 0;
  for (let a = 0; a < AGE_MAX; a++) if (a > x) rows += YEAR_COUNTS[a];
  return rows;
}
/** Fraction of bucket b that lies above x (for the bar highlight). */
function passFrac(b: number, x: number): number {
  const lo = b * WIDTH;
  const hi = lo + WIDTH;
  if (lo >= x) return 1;
  if (hi > x) return (hi - x) / WIDTH;
  return 0;
}

const FE = 3; // estimated fan-out per join (independence assumption)

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function compactRows(n: number): string {
  if (n >= 1_000_000) return `${round1(n / 1_000_000)}M`;
  if (n >= 1_000) return `${round1(n / 1_000)}k`;
  return `${Math.round(n)}`;
}

const BLUE = 'var(--color-fig-blue)';
const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';

export default function CardinalityScene() {
  const [x, setX] = useState(35); // predicate: age > x
  const [joins, setJoins] = useState(2);
  const [corr, setCorr] = useState(2); // per-join correlation the estimator misses

  const estBase = estimateRowsGt(x);
  const actBase = trueRowsGt(x);
  const selEst = estBase / N;
  const selTrue = actBase / N;
  const baseErr = estBase / actBase;

  const estRows = estBase * Math.pow(FE, joins);
  const actRows = actBase * Math.pow(FE * corr, joins);
  const off = actRows / estRows; // how far the estimate is from reality
  const compound = Math.pow(corr, 4); // headline: corr^4 over four joins

  // Comparison-bar widths: the larger (actual) fills the track; the estimate is
  // a proportional sliver — the smaller it is, the more visceral the miss.
  const estPct = Math.max(2, (estRows / actRows) * 100);

  return (
    <Figure
      number="7.3"
      caption={
        <>
          Cardinality estimation, the optimizer's hardest problem. <strong>①</strong> Drag
          the threshold and read the selectivity of <code>age&nbsp;&gt;&nbsp;x</code> off the
          histogram — the estimate (uniform within each bucket) sits close to the true count.{' '}
          <strong>②</strong> Then chain joins: each one assumes independence, and the
          correlation it misses compounds <em>multiplicatively</em> — a 2× miss per join
          becomes 16× over four. The plan is chosen from the estimate but pays the actual bill.
        </>
      }
    >
      <div className="card-wrap">
        {/* ───────────── ① histogram + predicate ───────────── */}
        <div className="card-label">① read selectivity off the histogram</div>

        <div
          className="card-hist"
          role="img"
          aria-label={`Histogram of age in ${BUCKETS} buckets; predicate age greater than ${x} passes about ${Math.round(
            selEst * 100,
          )} percent of rows`}
        >
          {/* threshold marker line */}
          <div className="card-threshold" style={{ left: `${(x / AGE_MAX) * 100}%` }}>
            <span className="card-threshold-tag">age&nbsp;&gt;&nbsp;{x}</span>
          </div>
          {HIST.map((count, b) => {
            const frac = passFrac(b, x);
            const barH = (count / HIST_MAX) * 100;
            return (
              <div key={b} className="card-bar-col">
                <div className="card-bar-track">
                  <div className="card-bar" style={{ height: `${barH}%` }}>
                    <div
                      className="card-bar-pass"
                      style={{ height: `${frac * 100}%`, background: frac > 0 ? BLUE : 'transparent' }}
                    />
                  </div>
                </div>
                <span className="card-bar-x">{b * WIDTH}</span>
              </div>
            );
          })}
        </div>

        <div className="card-slider">
          <Slider label="age >" min={5} max={75} step={1} value={x} onChange={setX} />
        </div>

        <div className="card-readrow">
          <div className="card-read" style={{ borderColor: BLUE }}>
            <div className="card-read-label">estimated (off histogram)</div>
            <div className="card-read-big" style={{ color: BLUE }}>
              {(selEst * 100).toFixed(0)}%
            </div>
            <div className="card-read-sub">≈ {compactRows(estBase)} rows</div>
          </div>
          <div className="card-read" style={{ borderColor: GREEN }}>
            <div className="card-read-label">true (actual data)</div>
            <div className="card-read-big" style={{ color: GREEN }}>
              {(selTrue * 100).toFixed(0)}%
            </div>
            <div className="card-read-sub">≈ {compactRows(actBase)} rows</div>
          </div>
        </div>

        <div className="card-note">
          Single-predicate error: <strong>{round1(baseErr)}×</strong>. A histogram is exact at
          bucket edges and approximate inside — small here. Now watch it compound.
        </div>

        <div className="card-divider" />

        {/* ───────────── ② join chain compounding ───────────── */}
        <div className="card-label">② chain joins — the error compounds</div>

        <div className="card-joinbtns" role="group" aria-label="number of joins in the chain">
          {[0, 1, 2, 3, 4].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setJoins(k)}
              className={`fig-btn ${joins === k ? 'fig-btn-primary' : ''}`}
              aria-pressed={joins === k}
            >
              {k} {k === 1 ? 'join' : 'joins'}
            </button>
          ))}
        </div>

        <div className="card-slider">
          <Slider
            label="correlation missed (× / join)"
            min={1}
            max={3}
            step={0.1}
            value={corr}
            onChange={(v) => setCorr(round1(v))}
          />
        </div>

        {/* the headline: how far off the estimate is, right now */}
        <div className="card-errfactor" style={{ borderColor: off >= 4 ? RED : 'rgba(0,0,0,0.12)' }}>
          <motion.div
            key={`${joins}-${corr}`}
            initial={{ scale: 0.9, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="card-errfactor-big"
            style={{ color: off >= 4 ? RED : 'var(--color-fig-fg)' }}
          >
            {round1(off)}×
          </motion.div>
          <div className="card-errfactor-label">estimate is off by</div>
        </div>

        {/* estimate vs actual, as proportional bars */}
        <div className="card-cmp">
          <div className="card-cmp-row">
            <span className="card-cmp-tag" style={{ color: BLUE }}>
              estimate
            </span>
            <div className="card-cmp-track">
              <motion.div
                animate={{ width: `${estPct}%` }}
                transition={{ duration: 0.3 }}
                className="card-cmp-fill"
                style={{ background: BLUE }}
              />
            </div>
            <span className="card-cmp-num tabular-nums">{compactRows(estRows)}</span>
          </div>
          <div className="card-cmp-row">
            <span className="card-cmp-tag" style={{ color: RED }}>
              actual
            </span>
            <div className="card-cmp-track">
              <motion.div
                animate={{ width: '100%' }}
                transition={{ duration: 0.3 }}
                className="card-cmp-fill"
                style={{ background: RED }}
              />
            </div>
            <span className="card-cmp-num tabular-nums">{compactRows(actRows)}</span>
          </div>
        </div>

        <div className="card-note">
          A <strong>{round1(corr)}×</strong> miss per join compounds to{' '}
          <strong style={{ color: RED }}>{round1(compound)}×</strong> over four joins. One bad
          estimate near the leaves can pick a plan orders of magnitude too slow.
        </div>
      </div>

      <style>{`
        .card-wrap { display: flex; flex-direction: column; gap: 14px; }
        .card-label {
          font-family: var(--font-sans); font-size: 10.5px; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fig-muted);
        }

        .card-hist {
          position: relative; display: flex; align-items: flex-end; gap: 5px;
          height: 132px; padding: 4px 0 0;
        }
        .card-bar-col {
          flex: 1 1 0; min-width: 0; display: flex; flex-direction: column;
          align-items: center; height: 100%;
        }
        .card-bar-track {
          width: 100%; flex: 1; display: flex; align-items: flex-end;
        }
        .card-bar {
          position: relative; width: 100%; border-radius: 4px 4px 0 0;
          background: rgba(30, 79, 165, 0.16);
          display: flex; align-items: flex-end; transition: height 200ms ease;
        }
        .card-bar-pass {
          width: 100%; border-radius: 4px 4px 0 0; transition: height 200ms ease, background 200ms ease;
        }
        .card-bar-x {
          font-family: var(--font-sans); font-size: 9.5px; color: var(--color-fig-muted);
          margin-top: 4px; font-variant-numeric: tabular-nums;
        }
        .card-threshold {
          position: absolute; top: -2px; bottom: 18px; width: 0;
          border-left: 2px dashed var(--color-fig-red); z-index: 2;
          transition: left 200ms ease; pointer-events: none;
        }
        .card-threshold-tag {
          position: absolute; top: -2px; left: 4px; white-space: nowrap;
          font-family: var(--font-sans); font-size: 9.5px; font-weight: 700;
          color: var(--color-fig-red); background: var(--color-fig-bg);
          padding: 0 3px; border-radius: 3px;
        }

        .card-slider { padding: 2px 0; }

        .card-readrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .card-read {
          border: 1px solid; border-radius: 9px; padding: 10px 8px; text-align: center;
          background: rgba(0,0,0,0.02);
        }
        .card-read-label {
          font-family: var(--font-sans); font-size: 9px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase; color: var(--color-fig-muted);
          line-height: 1.3;
        }
        .card-read-big {
          font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif;
          font-size: 2rem; font-weight: 600; line-height: 1.1; margin-top: 4px;
          font-variant-numeric: tabular-nums;
        }
        .card-read-sub {
          font-family: var(--font-sans); font-size: 10.5px; color: var(--color-fig-muted);
          font-variant-numeric: tabular-nums; margin-top: 2px;
        }

        .card-note {
          font-family: var(--font-sans); font-size: 12px; line-height: 1.5;
          color: var(--color-fig-muted);
        }
        .card-note strong { color: var(--color-fig-fg); font-variant-numeric: tabular-nums; }

        .card-divider { height: 1px; background: rgba(0,0,0,0.10); margin: 2px 0; }

        .card-joinbtns { display: flex; flex-wrap: wrap; gap: 6px; }

        .card-errfactor {
          display: flex; flex-direction: column; align-items: center;
          border: 1px solid; border-radius: 10px; padding: 12px 8px;
          background: rgba(0,0,0,0.02);
        }
        .card-errfactor-big {
          font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif;
          font-size: 3rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;
        }
        .card-errfactor-label {
          font-family: var(--font-sans); font-size: 10px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fig-muted);
          margin-top: 6px;
        }

        .card-cmp { display: flex; flex-direction: column; gap: 8px; }
        .card-cmp-row { display: flex; align-items: center; gap: 8px; }
        .card-cmp-tag {
          width: 56px; flex-shrink: 0; text-align: right;
          font-family: var(--font-sans); font-size: 10px; font-weight: 700;
          letter-spacing: 0.04em; text-transform: uppercase;
        }
        .card-cmp-track {
          flex: 1; height: 16px; border-radius: 5px; background: rgba(0,0,0,0.06);
          overflow: hidden;
        }
        .card-cmp-fill { height: 100%; border-radius: 5px; }
        .card-cmp-num {
          width: 52px; flex-shrink: 0; text-align: right;
          font-family: var(--font-mono, monospace); font-size: 11.5px; font-weight: 600;
          color: var(--color-fig-fg);
        }

        @media (max-width: 420px) {
          .card-hist { gap: 3px; height: 120px; }
          .card-read-big { font-size: 1.7rem; }
          .card-errfactor-big { font-size: 2.5rem; }
          .card-cmp-tag { width: 48px; font-size: 9px; }
          .card-cmp-num { width: 44px; font-size: 10.5px; }
        }
      `}</style>
    </Figure>
  );
}
