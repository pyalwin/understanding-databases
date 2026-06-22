import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * VersionChainScene — chapter 09 HERO scene (Figure 9.1).
 *
 * The defining image of MVCC: one logical row ("balance") accreting a CHAIN of
 * versions over time, and a reader's SNAPSHOT sliding along a timeline, lighting
 * up exactly which version that snapshot sees.
 *
 * Four transactions each append a new version and commit, one per moment on the
 * timeline (T1 $100, T2 $150, T3 $225, T4 $300). Every version is a tuple tagged
 * with xmin (the xid that created it) and xmax (the xid that deleted it — None
 * while live), exactly the canonical MVCCStore the chapter's sandboxes build.
 *
 * The reader's snapshot froze at moment `s`. The visibility rule is the whole
 * scene: a version is what the reader READS iff its creator had committed by `s`
 * (xmin ≤ s) and its deleter had NOT (xmax is None or xmax > s). Drag the snapshot
 * (or press Play to sweep it) and the single lit, green card walks down the chain —
 * the old values are still lying there, and the snapshot picks the right one.
 *
 * Cream palette only. Reflows at 390px: the timeline scrolls/scales inside the
 * figure, the version chain is a vertical stack that needs no horizontal room, and
 * the controls wrap full-width.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

interface Version {
  value: string;
  xmin: number;
  xmax: number | null;
}

// One logical row, four committed versions. Transaction k commits at moment k, so
// commitTime(xid) === xid. Each write appended a version and stamped the previous
// one's xmax with its own xid (append, don't overwrite).
const VERSIONS: Version[] = [
  { value: '$100', xmin: 1, xmax: 2 },
  { value: '$150', xmin: 2, xmax: 3 },
  { value: '$225', xmin: 3, xmax: 4 },
  { value: '$300', xmin: 4, xmax: null },
];

const COMMITS: { t: number; txn: string; value: string }[] = [
  { t: 1, txn: 'T1', value: '$100' },
  { t: 2, txn: 'T2', value: '$150' },
  { t: 3, txn: 'T3', value: '$225' },
  { t: 4, txn: 'T4', value: '$300' },
];

const T_MAX = 4;

type VState = 'future' | 'visible' | 'dead';

// The visibility rule, applied to one version at snapshot time s.
function stateOf(v: Version, s: number): VState {
  if (v.xmin > s) return 'future'; // creator hadn't committed by my snapshot
  if (v.xmax !== null && v.xmax <= s) return 'dead'; // deleter had committed → superseded
  return 'visible'; // creator visible, deleter not → this is what I read
}

/* ------------------------------------------------------------------ */
/*  Timeline (horizontal, scrolls/scales inside the figure)           */
/* ------------------------------------------------------------------ */

const TL_W = 480;
const TL_H = 96;
const TL_L = 40;
const TL_R = 40;

function tx(t: number): number {
  return TL_L + (t / T_MAX) * (TL_W - TL_L - TL_R);
}

function Timeline({ s }: { s: number }) {
  const axisY = 56;
  return (
    <svg
      width={TL_W}
      height={TL_H}
      viewBox={`0 0 ${TL_W} ${TL_H}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="commit timeline with the reader's snapshot marker"
    >
      {/* axis */}
      <line x1={TL_L - 10} y1={axisY} x2={TL_W - TL_R + 10} y2={axisY} stroke={MUTED} strokeWidth={1.5} />

      {/* commit ticks */}
      {COMMITS.map((c) => {
        const x = tx(c.t);
        const passed = c.t <= s;
        return (
          <g key={c.txn}>
            <line
              x1={x}
              y1={axisY - 7}
              x2={x}
              y2={axisY + 7}
              stroke={passed ? GREEN : MUTED}
              strokeWidth={2}
            />
            <text
              x={x}
              y={axisY - 14}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={passed ? GREEN : MUTED}
              fontFamily="ui-monospace, monospace"
            >
              {c.txn}
            </text>
            <text
              x={x}
              y={axisY + 24}
              textAnchor="middle"
              fontSize={11}
              fill={passed ? 'var(--color-fig-fg)' : MUTED}
              fontFamily="ui-monospace, monospace"
            >
              {c.value}
            </text>
          </g>
        );
      })}

      {/* snapshot marker */}
      <motion.g animate={{ x: tx(s) }} transition={{ type: 'spring', stiffness: 220, damping: 26 }}>
        <line x1={0} y1={axisY - 26} x2={0} y2={axisY + 30} stroke={BLUE} strokeWidth={2} strokeDasharray="4 3" />
        <polygon points="0,-26 -7,-36 7,-36" transform={`translate(0 ${axisY})`} fill={BLUE} />
        <text
          x={0}
          y={axisY - 40}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={700}
          fill={BLUE}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          snapshot
        </text>
      </motion.g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Version card                                                      */
/* ------------------------------------------------------------------ */

const STATE_META: Record<VState, { label: string; color: string }> = {
  future: { label: 'not yet created', color: MUTED },
  visible: { label: 'your snapshot reads this', color: GREEN },
  dead: { label: 'superseded', color: ACCENT },
};

function Badge({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded font-mono"
      style={{
        padding: '1px 7px',
        fontSize: 11.5,
        background: 'var(--color-fig-bg)',
        border: `1px solid ${color}66`,
        color: 'var(--color-fig-fg)',
      }}
    >
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ fontWeight: 700, color }}>{v}</span>
    </span>
  );
}

function VersionCard({ v, state }: { v: Version; state: VState }) {
  const meta = STATE_META[state];
  const isVisible = state === 'visible';
  const isFuture = state === 'future';
  return (
    <motion.div
      layout
      className="fig-card"
      animate={{
        opacity: isFuture ? 0.45 : 1,
        borderColor: isVisible ? GREEN : 'rgba(0,0,0,0.12)',
      }}
      transition={{ duration: 0.35 }}
      style={{
        padding: '10px 12px',
        borderWidth: isVisible ? 2 : 1,
        borderStyle: isFuture ? 'dashed' : 'solid',
        boxShadow: isVisible ? `0 0 0 3px ${GREEN}22` : 'none',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="font-mono font-bold"
          style={{
            fontSize: 19,
            color: state === 'dead' ? MUTED : 'var(--color-fig-fg)',
            textDecoration: state === 'dead' ? 'line-through' : 'none',
          }}
        >
          {v.value}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-sans font-semibold"
          style={{ fontSize: 10.5, background: 'var(--color-fig-bg)', border: `1px solid ${meta.color}`, color: meta.color }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge k="xmin" v={String(v.xmin)} color={BLUE} />
        <Badge k="xmax" v={v.xmax === null ? 'None' : String(v.xmax)} color={v.xmax === null ? GREEN : RED} />
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function VersionChainScene() {
  const [s, setS] = useState(2);
  const [playing, setPlaying] = useState(false);

  const states = useMemo(() => VERSIONS.map((v) => stateOf(v, s)), [s]);
  const readValue = useMemo(() => {
    const i = states.indexOf('visible');
    return i === -1 ? null : VERSIONS[i].value;
  }, [states]);

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setS((cur) => {
        if (cur >= T_MAX) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, 850);
    return () => clearTimeout(t);
  }, [playing, s]);

  const play = () => {
    if (s >= T_MAX) setS(0);
    setPlaying(true);
  };

  // Narration of the read, echoing the visibility rule.
  const note =
    s === 0
      ? 'Snapshot at t = 0: no transaction has committed yet, so every version is still in the future. The reader sees nothing — the row does not exist to it.'
      : `Snapshot at t = ${s}: the reader reads ${readValue}. Its creator (xmin) had committed by t = ${s}; its deleter (xmax) had not. Every other version is still lying on the heap — created later, or already superseded — but invisible to THIS snapshot.`;

  return (
    <Figure
      number="9.1"
      caption="One row, four versions. Each write appended a new tuple instead of overwriting, tagging it with xmin (the transaction that created it) and xmax (the one that deleted it, None while live). A reader's snapshot froze at a moment on the timeline and reads exactly one version: the one whose creator had committed by then and whose deleter had not. Slide the snapshot — or press Play to sweep it — and the single green card walks down the chain. The old values never went anywhere; the snapshot just picks the right one. On a narrow screen the timeline scrolls and the chain stacks."
    >
      <div className="space-y-4">
        {/* timeline */}
        <div
          className="fig-card"
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            commit timeline
          </div>
          <Timeline s={s} />
        </div>

        {/* read-out pill */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: 'var(--color-fig-bg)', border: `1px solid ${BLUE}`, color: BLUE }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: BLUE, display: 'inline-block' }} />
            snapshot @ t = {s}
          </span>
          <span className="font-mono text-[12.5px]" style={{ color: 'var(--color-fig-fg)' }}>
            read(&quot;balance&quot;) →{' '}
            <span style={{ fontWeight: 700, color: readValue ? GREEN : MUTED }}>{readValue ?? 'None'}</span>
          </span>
        </div>

        {/* version chain — vertical stack, with the "newer" arrow between cards */}
        <div className="space-y-1.5">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            version chain · row &quot;balance&quot;
          </div>
          {VERSIONS.map((v, i) => (
            <div key={i} className="space-y-1.5">
              <VersionCard v={v} state={states[i]} />
              {i < VERSIONS.length - 1 && (
                <div className="flex justify-center" style={{ color: MUTED, lineHeight: 1 }} aria-hidden="true">
                  <span style={{ fontSize: 14 }}>↓</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
            minHeight: 52,
          }}
        >
          {note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {s >= T_MAX ? 'Replay' : 'Play'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setS(0);
            }}
            className="fig-btn fig-btn-danger"
            style={{ minHeight: 38 }}
          >
            Reset
          </button>
        </div>

        {/* snapshot slider */}
        <div className="space-y-1 pt-0.5">
          <Slider
            label="snapshot t"
            min={0}
            max={T_MAX}
            step={1}
            value={s}
            onChange={(v) => {
              setPlaying(false);
              setS(v);
            }}
          />
        </div>
      </div>
    </Figure>
  );
}
