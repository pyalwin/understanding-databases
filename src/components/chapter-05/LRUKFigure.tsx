import React from 'react';
import { useState } from 'react';
import { Figure } from '@/components/scene';

/*
 * LRUKFigure — chapter 05 §6.
 *
 * A mostly-static comparison of LRU-1 (plain LRU) vs LRU-2. Two pages share one
 * time axis:
 *   - a HOT page with a real access history (four touches), and
 *   - a one-shot SCAN page touched exactly once, most recently of all.
 *
 * A toggle flips the eviction rule between K=1 and K=2. LRU-1 judges a page by
 * its single most-recent access, so the scan page (most recent) survives and the
 * hot page is wrongly evicted. LRU-2 judges by the 2nd-most-recent access — the
 * scan page has none, so it is evicted first and the hot page stays. The
 * 2nd-most-recent markers are the visual focal point.
 *
 * Mobile (390px): the two timeline rows stay full width and stack naturally;
 * the verdict panel sits below.
 */

const T_MAX = 20;

interface PageTrace {
  id: string;
  label: string;
  kind: 'hot' | 'scan';
  accesses: number[]; // ascending times; last is most-recent
}

const HOT: PageTrace = {
  id: 'H',
  label: 'Hot page',
  kind: 'hot',
  accesses: [3, 7, 11, 16],
};
const SCAN: PageTrace = {
  id: 'S',
  label: 'Scan page',
  kind: 'scan',
  accesses: [18],
};

/** The Kth-most-recent access time, or null if the page has fewer than K. */
function kthMostRecent(p: PageTrace, k: number): number | null {
  if (p.accesses.length < k) return null;
  return p.accesses[p.accesses.length - k];
}

const COL = {
  blue: 'var(--color-fig-blue)',
  green: 'var(--color-fig-green)',
  orange: 'var(--color-fig-orange)',
  muted: 'var(--color-fig-muted)',
  fg: 'var(--color-fig-fg)',
};

function Row({ page, k }: { page: PageTrace; k: number }) {
  const kth = kthMostRecent(page, k);
  const secondIdx = page.accesses.length - 2; // index of 2nd-most-recent
  return (
    <div className="lk-row">
      <div className="lk-row-head">
        <span className="lk-row-label" style={{ color: page.kind === 'scan' ? COL.orange : COL.fg }}>
          {page.label}
        </span>
        <span className="lk-row-sub">
          {page.kind === 'scan' ? 'touched once (a sequential scan)' : 'touched repeatedly (genuinely hot)'}
        </span>
      </div>
      <div className="lk-track">
        <div className="lk-axis" />
        {page.accesses.map((t, i) => {
          const isMostRecent = i === page.accesses.length - 1;
          const isSecond = i === secondIdx;
          const isDecision = kth !== null && t === kth;
          // Emphasis: when K=2, the 2nd-most-recent marker is the focal point.
          const focal = k === 2 && isSecond;
          return (
            <div
              key={t}
              className={
                'lk-dot' +
                (isMostRecent ? ' lk-dot-recent' : '') +
                (isDecision ? ' lk-dot-decision' : '') +
                (focal ? ' lk-dot-focal' : '')
              }
              style={{ left: `${(t / T_MAX) * 100}%` }}
              title={`access at t=${t}`}
            >
              <span className="lk-dot-time">t{t}</span>
            </div>
          );
        })}
      </div>
      <div className="lk-row-foot">
        {k === 2 && page.accesses.length < 2 ? (
          <span className="lk-nokth">✗ no 2nd-most-recent access — treated as infinitely old</span>
        ) : (
          <span className="lk-kth">
            {k === 1 ? 'most-recent' : '2nd-most-recent'} access:{' '}
            <b style={{ color: COL.blue }}>t{kth}</b>
          </span>
        )}
      </div>
    </div>
  );
}

export default function LRUKFigure() {
  const [k, setK] = useState<1 | 2>(1);

  // Decide the victim: the page whose Kth-most-recent access is oldest;
  // a missing Kth access counts as infinitely old, so it is evicted first.
  const hotKth = kthMostRecent(HOT, k);
  const scanKth = kthMostRecent(SCAN, k);
  const score = (v: number | null) => (v === null ? -Infinity : v);
  const victim = score(scanKth) < score(hotKth) ? SCAN : HOT;
  const correct = victim.id === SCAN.id;

  return (
    <Figure
      number="5.5"
      caption={
        <>
          <strong>LRU-1 vs LRU-2.</strong> Plain LRU judges a page by its single
          most-recent touch, so a one-shot scan page outranks a genuinely hot one
          and the hot page is evicted. <strong>LRU-2</strong> judges by the{' '}
          <em>2nd-most-recent</em> access — the scan page has none, so it is
          evicted first and the hot page survives. Flip the rule and watch the
          verdict change.
        </>
      }
    >
      <div className="lk-wrap">
        {/* toggle */}
        <div className="lk-toggle" role="group" aria-label="eviction rule">
          <button
            type="button"
            className={'fig-btn' + (k === 1 ? ' fig-btn-primary' : '')}
            aria-pressed={k === 1}
            onClick={() => setK(1)}
          >
            LRU-1 (plain)
          </button>
          <button
            type="button"
            className={'fig-btn' + (k === 2 ? ' fig-btn-primary' : '')}
            aria-pressed={k === 2}
            onClick={() => setK(2)}
          >
            LRU-2
          </button>
          <span className="lk-rule">
            evict by the <b>{k === 1 ? 'most-recent' : '2nd-most-recent'}</b> access
          </span>
        </div>

        <Row page={HOT} k={k} />
        <Row page={SCAN} k={k} />

        {/* axis caption */}
        <div className="lk-time">time →</div>

        {/* verdict */}
        <div className={'lk-verdict' + (correct ? ' lk-ok' : ' lk-bad')}>
          <div className="lk-verdict-head">
            {correct ? '✓ LRU-2 evicts the scan page' : '✗ LRU-1 evicts the hot page'}
          </div>
          <div className="lk-verdict-body">
            {k === 1 ? (
              <>
                The scan page's single touch (t18) is more recent than the hot
                page's last touch (t16), so plain LRU keeps the scan page and
                throws out the page you actually need. One touch from a scan looks
                identical to one touch from a hot page.
              </>
            ) : (
              <>
                The scan page has <b>no 2nd-most-recent access</b>, so LRU-2 ranks
                it as infinitely old and evicts it first. The hot page's
                2nd-most-recent touch (t11) proves it has a history — recency{' '}
                <em>and</em> frequency, in one rule.
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .lk-wrap { display: flex; flex-direction: column; gap: 14px; }
        .lk-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .lk-rule {
          font-family: var(--font-sans); font-size: 12px; color: var(--color-fig-muted);
        }
        .lk-rule b { color: var(--color-fig-fg); }

        .lk-row {
          background: rgba(0,0,0,0.025); border: 1px solid rgba(0,0,0,0.08);
          border-radius: 10px; padding: 12px 14px 10px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .lk-row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
        .lk-row-label { font-family: var(--font-sans); font-size: 13px; font-weight: 700; }
        .lk-row-sub { font-family: var(--font-sans); font-size: 11px; color: var(--color-fig-muted); }

        .lk-track { position: relative; height: 34px; margin: 6px 10px 2px; }
        .lk-axis {
          position: absolute; left: 0; right: 0; top: 50%;
          height: 2px; background: rgba(0,0,0,0.14); border-radius: 2px;
        }
        .lk-dot {
          position: absolute; top: 50%; transform: translate(-50%, -50%);
          width: 13px; height: 13px; border-radius: 50%;
          background: var(--color-fig-bg); border: 2px solid var(--color-fig-muted);
          transition: all 220ms ease;
        }
        .lk-dot-time {
          position: absolute; top: -17px; left: 50%; transform: translateX(-50%);
          font-family: var(--font-mono, monospace); font-size: 10px;
          color: var(--color-fig-muted); white-space: nowrap;
        }
        .lk-dot-recent { border-color: var(--color-fig-fg); }
        .lk-dot-decision {
          background: var(--color-fig-blue); border-color: var(--color-fig-blue);
          box-shadow: 0 0 0 3px rgba(30,79,165,0.20);
        }
        .lk-dot-decision .lk-dot-time { color: var(--color-fig-blue); font-weight: 700; }
        .lk-dot-focal {
          width: 17px; height: 17px;
          box-shadow: 0 0 0 5px rgba(30,79,165,0.18);
        }

        .lk-row-foot { font-family: var(--font-sans); font-size: 11.5px; }
        .lk-kth { color: var(--color-fig-muted); }
        .lk-nokth { color: var(--color-fig-orange); font-weight: 600; }

        .lk-time {
          font-family: var(--font-sans); font-size: 11px; color: var(--color-fig-muted);
          text-align: right; margin-top: -6px; padding-right: 10px;
        }

        .lk-verdict {
          border-radius: 10px; padding: 12px 14px;
          border: 1px solid; display: flex; flex-direction: column; gap: 5px;
        }
        .lk-ok { background: rgba(47,107,58,0.08); border-color: rgba(47,107,58,0.35); }
        .lk-bad { background: rgba(176,74,20,0.08); border-color: rgba(176,74,20,0.35); }
        .lk-verdict-head {
          font-family: var(--font-sans); font-size: 13px; font-weight: 700;
          color: var(--color-fig-fg);
        }
        .lk-verdict-body {
          font-family: var(--font-sans); font-size: 12.5px; line-height: 1.5;
          color: var(--color-fig-fg);
        }
        .lk-verdict-body b { color: var(--color-fig-orange); }
      `}</style>
    </Figure>
  );
}
