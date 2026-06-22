import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * SnapshotScene — chapter 09, Figure 9.2 (§4 snapshot isolation).
 *
 * Two concurrent writers and one reader over a single row `x`, on a fixed
 * schedule that makes snapshot isolation's two promises visible:
 *
 *   setup commits x = 100
 *   T1, T2, R all begin (each takes a snapshot while x is still 100)
 *   T1 writes x = 150  -> a NEW version is appended; the old one's xmax = T1
 *   T1 commits
 *   R re-reads x       -> STILL 100  (readers don't block writers; snapshot frozen)
 *   T2 writes x = 200  -> the version it sees was already updated+committed by
 *                         T1: write-write conflict -> T2 ABORTS (first-committer-wins)
 *
 * Three panels share one frame model: the version chain of row x (each version
 * a card with value / xmin / xmax), the three transaction lanes (status + the
 * value each currently sees), and a running note. Cream palette only; the lanes
 * stack and the version chain scrolls at 390px.
 */

type Tid = 'T1' | 'T2' | 'R';
type TStatus = 'idle' | 'active' | 'committed' | 'aborted';

const MUTED = 'var(--color-fig-muted)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const RED = 'var(--color-fig-red)';
const ACCENT = 'var(--color-fig-orange)';

interface Version {
  value: number;
  xmin: string; // creator label
  xmax: string | null; // deleter label
  fresh?: boolean; // just appended on this frame (for the grow animation)
}

interface Lane {
  status: TStatus;
  sees: number | null; // value this txn reads from its snapshot (null = not begun)
  role: string; // "reader" | "writer"
}

interface Frame {
  note: string;
  phase: string;
  versions: Version[];
  lanes: Record<Tid, Lane>;
  highlight: Tid | null; // lane to pulse (e.g. reader staying old, or abort)
  conflict: boolean; // T2's write-write conflict fired on this frame
}

const ORDER: Tid[] = ['T1', 'T2', 'R'];

function buildFrames(): Frame[] {
  const idleLane = (role: string): Lane => ({ status: 'idle', sees: null, role });
  const frames: Frame[] = [];

  // 0 — seed committed
  frames.push({
    note: 'A setup transaction has committed x = 100. Press Play (or Step) to start two concurrent writers and one reader — all over this single row.',
    phase: 'seed',
    versions: [{ value: 100, xmin: 'setup', xmax: null }],
    lanes: { T1: idleLane('writer'), T2: idleLane('writer'), R: idleLane('reader') },
    highlight: null,
    conflict: false,
  });

  // 1 — all three begin, take snapshots while x is still 100
  frames.push({
    note: 'T1, T2 and R all begin while x is still 100. Each takes a snapshot — a frozen view of what had committed at that instant. All three see 100.',
    phase: 'begin',
    versions: [{ value: 100, xmin: 'setup', xmax: null }],
    lanes: {
      T1: { status: 'active', sees: 100, role: 'writer' },
      T2: { status: 'active', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: null,
    conflict: false,
  });

  // 2 — T1 writes a new version (append; old.xmax = T1)
  frames.push({
    note: 'T1 writes x = 150. Nothing is overwritten: a NEW version is appended and the old one is stamped xmax = T1 (deleted-by-T1). T1 is not committed yet.',
    phase: 'write',
    versions: [
      { value: 100, xmin: 'setup', xmax: 'T1' },
      { value: 150, xmin: 'T1', xmax: null, fresh: true },
    ],
    lanes: {
      T1: { status: 'active', sees: 150, role: 'writer' },
      T2: { status: 'active', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: null,
    conflict: false,
  });

  // 3 — T1 commits
  frames.push({
    note: 'T1 commits. Its 150 version is now the live one for anyone who begins from here on. But R and T2 took their snapshots before this commit.',
    phase: 'commit',
    versions: [
      { value: 100, xmin: 'setup', xmax: 'T1' },
      { value: 150, xmin: 'T1', xmax: null },
    ],
    lanes: {
      T1: { status: 'committed', sees: 150, role: 'writer' },
      T2: { status: 'active', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: null,
    conflict: false,
  });

  // 4 — R re-reads: STILL 100 (readers don't block writers)
  frames.push({
    note: 'R re-reads x and still gets 100. It never waited for T1 and never took a lock — its snapshot makes the old version visible even though a newer one is committed right beside it.',
    phase: 'reader',
    versions: [
      { value: 100, xmin: 'setup', xmax: 'T1' },
      { value: 150, xmin: 'T1', xmax: null },
    ],
    lanes: {
      T1: { status: 'committed', sees: 150, role: 'writer' },
      T2: { status: 'active', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: 'R',
    conflict: false,
  });

  // 5 — T2 writes → conflict → abort
  frames.push({
    note: 'T2 still sees 100 and tries x = 200. But the version it sees was already updated and committed by T1: a write-write conflict. First-committer-wins — T2 ABORTS.',
    phase: 'conflict',
    versions: [
      { value: 100, xmin: 'setup', xmax: 'T1' },
      { value: 150, xmin: 'T1', xmax: null },
    ],
    lanes: {
      T1: { status: 'committed', sees: 150, role: 'writer' },
      T2: { status: 'aborted', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: 'T2',
    conflict: true,
  });

  // 6 — done
  frames.push({
    note: 'Outcome: T1’s 150 survived, T2 left no trace, and the reader saw a consistent 100 throughout. Readers never blocked writers; the write-write race had exactly one winner.',
    phase: 'done',
    versions: [
      { value: 100, xmin: 'setup', xmax: 'T1' },
      { value: 150, xmin: 'T1', xmax: null },
    ],
    lanes: {
      T1: { status: 'committed', sees: 150, role: 'writer' },
      T2: { status: 'aborted', sees: 100, role: 'writer' },
      R: { status: 'active', sees: 100, role: 'reader' },
    },
    highlight: null,
    conflict: false,
  });

  return frames;
}

const STATUS_META: Record<TStatus, { label: string; color: string }> = {
  idle: { label: 'idle', color: MUTED },
  active: { label: 'running', color: GREEN },
  committed: { label: 'committed', color: BLUE },
  aborted: { label: 'aborted', color: RED },
};

function VersionCard({ v }: { v: Version }) {
  const live = v.xmax === null;
  return (
    <motion.div
      layout
      initial={v.fresh ? { opacity: 0, scale: 0.8, y: -6 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="fig-card"
      style={{
        minWidth: 116,
        padding: '8px 10px',
        borderColor: live ? `${GREEN}88` : 'rgba(0,0,0,0.14)',
        background: live ? `${GREEN}12` : 'var(--color-fig-bg)',
        opacity: live ? 1 : 0.72,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[15px] font-bold" style={{ color: 'var(--color-fig-fg)' }}>
          x = {v.value}
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold font-sans"
          style={{
            background: live ? `${GREEN}1f` : 'rgba(0,0,0,0.05)',
            color: live ? GREEN : MUTED,
            border: `1px solid ${live ? `${GREEN}66` : 'rgba(0,0,0,0.12)'}`,
          }}
        >
          {live ? 'live' : 'dead'}
        </span>
      </div>
      <div className="mt-1.5 flex gap-3 font-mono text-[11px]" style={{ color: MUTED }}>
        <span>
          xmin <span style={{ color: BLUE, fontWeight: 700 }}>{v.xmin}</span>
        </span>
        <span>
          xmax{' '}
          <span style={{ color: v.xmax ? RED : MUTED, fontWeight: 700 }}>{v.xmax ?? '—'}</span>
        </span>
      </div>
    </motion.div>
  );
}

function TxnLane({ id, lane, pulse }: { id: Tid; lane: Lane; pulse: boolean }) {
  const meta = STATUS_META[lane.status];
  return (
    <motion.div
      layout
      animate={pulse ? { scale: [1, 1.03, 1] } : { scale: 1 }}
      transition={{ duration: 0.6, repeat: pulse ? Infinity : 0 }}
      className="fig-card"
      style={{ flex: 1, minWidth: 0, borderColor: `${meta.color}66`, padding: '10px 12px' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-bold" style={{ color: 'var(--color-fig-fg)' }}>
          {id}
          <span className="ml-1.5 font-sans text-[11px] font-normal" style={{ color: MUTED }}>
            {lane.role}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold font-sans"
          style={{ background: 'var(--color-fig-bg)', border: `1px solid ${meta.color}`, color: meta.color }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[12px] font-sans" style={{ color: MUTED }}>
        <span>sees x =</span>
        {lane.sees === null ? (
          <span className="font-mono" style={{ color: MUTED }}>
            —
          </span>
        ) : (
          <span
            className="font-mono"
            style={{
              padding: '1px 8px',
              borderRadius: 5,
              background: lane.status === 'aborted' ? `${RED}14` : `${BLUE}14`,
              border: `1px solid ${lane.status === 'aborted' ? `${RED}66` : `${BLUE}66`}`,
              color: 'var(--color-fig-fg)',
              fontWeight: 700,
            }}
          >
            {lane.sees}
          </span>
        )}
      </div>
    </motion.div>
  );
}

export default function SnapshotScene() {
  const frames = useMemo(() => buildFrames(), []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 1100 - speed * 140;
    const t = setTimeout(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [playing, idx, speed, frames.length]);

  const play = () => {
    if (atEnd) setIdx(0);
    setPlaying(true);
  };
  const step = () => {
    setPlaying(false);
    setIdx((i) => Math.min(i + 1, frames.length - 1));
  };
  const reset = () => {
    setPlaying(false);
    setIdx(0);
  };

  return (
    <Figure
      number="9.2"
      caption="Snapshot isolation over one row x. Three transactions begin while x = 100; each freezes a snapshot. T1 appends a new version (x = 150) and commits — yet the reader R, holding an older snapshot, keeps reading 100 without ever waiting (readers don't block writers). When T2 tries to write the same row it sees was already updated and committed by T1, that write-write conflict makes T2 abort: first-committer-wins. The version chain shows each version's xmin (creator) and xmax (deleter). Lanes stack and the chain scrolls at narrow widths."
    >
      <div className="space-y-4">
        {/* phase pill */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.conflict ? RED : 'rgba(0,0,0,0.14)'}`,
              color: frame.conflict ? RED : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.conflict ? RED : frame.phase === 'done' ? GREEN : ACCENT,
                display: 'inline-block',
              }}
            />
            {frame.conflict ? 'write-write conflict' : frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* version chain */}
        <div
          className="fig-card"
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
        >
          <div
            className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: MUTED }}
          >
            version chain of row x
          </div>
          <div className="flex items-stretch gap-2" style={{ minWidth: 'min-content' }}>
            <AnimatePresence initial={false}>
              {frame.versions.map((v, i) => (
                <React.Fragment key={`${v.xmin}-${i}`}>
                  {i > 0 && (
                    <span className="flex items-center font-mono text-[14px]" style={{ color: MUTED }}>
                      →
                    </span>
                  )}
                  <VersionCard v={v} />
                </React.Fragment>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* transaction lanes */}
        <div className="flex flex-col sm:flex-row gap-3">
          {ORDER.map((id) => (
            <TxnLane key={id} id={id} lane={frame.lanes[id]} pulse={frame.highlight === id} />
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
            minHeight: 58,
          }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {atEnd ? 'Replay' : idx === 0 ? 'Play' : 'Resume'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
        </div>

        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
