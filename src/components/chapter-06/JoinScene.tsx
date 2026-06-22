import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * JoinScene — chapter 06 HERO scene (Figure 6.3).
 *
 * One reusable two-input join visualizer with a 3-way mode switch. The SAME
 * two tables (users ⋈ orders on the user id) run through all three algorithms
 * so the shared comparisons/work counter is directly comparable:
 *
 *   nested-loop : for each outer row, sweep the WHOLE inner side   → ~n·m
 *   hash        : BUILD a hash table on the smaller side (blocking),
 *                 then PROBE it with the larger side               → ~n+m
 *   sort-merge  : SORT both sides (blocking), then MERGE in one
 *                 lockstep pass                                     → sort + (n+m)
 *
 * Execution is modelled as a precomputed list of frames per mode; a playhead
 * steps/plays through them, so the counter climbs deterministically and the
 * reader can compare the three on identical data. Cream palette only. Reflows
 * to a single column at 390px (inputs stack, counters stay above).
 */

/* ------------------------------------------------------------------ */
/*  Shared data — identical to the §4/§5/§6 Python sandboxes          */
/* ------------------------------------------------------------------ */

interface User {
  id: number;
  name: string;
}
interface Order {
  uid: number;
  item: string;
}

const USERS: readonly User[] = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Cy' },
  { id: 4, name: 'Di' }, // Di has no orders — drops out of every join
  { id: 5, name: 'Eve' },
];

const ORDERS: readonly Order[] = [
  { uid: 3, item: 'book' },
  { uid: 1, item: 'pen' },
  { uid: 5, item: 'ink' },
  { uid: 1, item: 'ruler' },
  { uid: 3, item: 'lamp' },
  { uid: 2, item: 'case' },
  { uid: 5, item: 'case' },
];

const N = USERS.length; // smaller side
const M = ORDERS.length; // larger side

/* ------------------------------------------------------------------ */
/*  Frame model                                                       */
/* ------------------------------------------------------------------ */

type Mode = 'nl' | 'hash' | 'sortmerge';
type Phase = 'idle' | 'scan' | 'build' | 'probe' | 'sort' | 'merge' | 'done';

interface Pair {
  name: string;
  item: string;
}

interface Bucket {
  key: number;
  names: string[];
}

interface Frame {
  phase: Phase;
  note: string;
  comparisons: number;
  activeLeft: number | null; // ORIGINAL index into USERS
  activeRight: number | null; // ORIGINAL index into ORDERS
  matchFlash: boolean;
  emitted: Pair[];
  blocking: boolean;
  buckets: Bucket[] | null; // hash mode only
  leftOrder: number[]; // ORIGINAL indices, in display order
  rightOrder: number[];
}

const IDENT_L = USERS.map((_, i) => i);
const IDENT_R = ORDERS.map((_, i) => i);

function bucketsFrom(buildCount: number): Bucket[] {
  const map = new Map<number, string[]>();
  for (let i = 0; i < buildCount; i++) {
    const u = USERS[i];
    if (!map.has(u.id)) map.set(u.id, []);
    map.get(u.id)!.push(u.name);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, names]) => ({ key, names }));
}

/* --- nested-loop frames --------------------------------------------- */
function buildNestedLoop(): Frame[] {
  const frames: Frame[] = [];
  const emitted: Pair[] = [];
  let comparisons = 0;
  frames.push({
    phase: 'idle',
    note: 'Nested-loop join: for each user, scan every order. Step or play.',
    comparisons: 0,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: [],
    blocking: false,
    buckets: null,
    leftOrder: IDENT_L,
    rightOrder: IDENT_R,
  });
  for (let oi = 0; oi < N; oi++) {
    for (let ri = 0; ri < M; ri++) {
      comparisons++;
      const match = USERS[oi].id === ORDERS[ri].uid;
      if (match) emitted.push({ name: USERS[oi].name, item: ORDERS[ri].item });
      frames.push({
        phase: 'scan',
        note: match
          ? `${USERS[oi].name} (id ${USERS[oi].id}) = order uid ${ORDERS[ri].uid} ✓ match`
          : `${USERS[oi].name} (id ${USERS[oi].id}) vs order uid ${ORDERS[ri].uid}`,
        comparisons,
        activeLeft: oi,
        activeRight: ri,
        matchFlash: match,
        emitted: emitted.slice(),
        blocking: false,
        buckets: null,
        leftOrder: IDENT_L,
        rightOrder: IDENT_R,
      });
    }
  }
  frames.push({
    phase: 'done',
    note: `Done. ${comparisons} comparisons (= ${N}×${M} = n·m) for ${emitted.length} rows.`,
    comparisons,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: emitted.slice(),
    blocking: false,
    buckets: null,
    leftOrder: IDENT_L,
    rightOrder: IDENT_R,
  });
  return frames;
}

/* --- hash frames ---------------------------------------------------- */
function buildHash(): Frame[] {
  const frames: Frame[] = [];
  const emitted: Pair[] = [];
  let comparisons = 0;
  frames.push({
    phase: 'idle',
    note: 'Hash join: build a table on the smaller side, then probe it.',
    comparisons: 0,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: [],
    blocking: false,
    buckets: bucketsFrom(0),
    leftOrder: IDENT_L,
    rightOrder: IDENT_R,
  });
  // BUILD — blocking
  for (let bi = 0; bi < N; bi++) {
    comparisons++;
    frames.push({
      phase: 'build',
      note: `BUILD: hash ${USERS[bi].name} into bucket[${USERS[bi].id}] (blocking)`,
      comparisons,
      activeLeft: bi,
      activeRight: null,
      matchFlash: false,
      emitted: [],
      blocking: true,
      buckets: bucketsFrom(bi + 1),
      leftOrder: IDENT_L,
      rightOrder: IDENT_R,
    });
  }
  const full = bucketsFrom(N);
  // PROBE — pipelined
  for (let pi = 0; pi < M; pi++) {
    comparisons++;
    const key = ORDERS[pi].uid;
    const matchUserIdx = USERS.findIndex((u) => u.id === key);
    const hit = matchUserIdx !== -1;
    if (hit) emitted.push({ name: USERS[matchUserIdx].name, item: ORDERS[pi].item });
    frames.push({
      phase: 'probe',
      note: hit
        ? `PROBE bucket[${key}] → ${USERS[matchUserIdx].name} ✓`
        : `PROBE bucket[${key}] → empty, skip`,
      comparisons,
      activeLeft: hit ? matchUserIdx : null,
      activeRight: pi,
      matchFlash: hit,
      emitted: emitted.slice(),
      blocking: false,
      buckets: full,
      leftOrder: IDENT_L,
      rightOrder: IDENT_R,
    });
  }
  frames.push({
    phase: 'done',
    note: `Done. ${comparisons} touches (~${N}+${M} = n+m) for ${emitted.length} rows.`,
    comparisons,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: emitted.slice(),
    blocking: false,
    buckets: full,
    leftOrder: IDENT_L,
    rightOrder: IDENT_R,
  });
  return frames;
}

/* --- sort-merge frames ---------------------------------------------- */
function buildSortMerge(): Frame[] {
  const frames: Frame[] = [];
  const emitted: Pair[] = [];
  let comparisons = 0;

  const leftSorted = USERS.map((_, i) => i).sort((a, b) => USERS[a].id - USERS[b].id);
  const rightSorted = ORDERS.map((_, i) => i).sort((a, b) => ORDERS[a].uid - ORDERS[b].uid);

  frames.push({
    phase: 'idle',
    note: 'Sort-merge join: sort both sides, then merge in one pass.',
    comparisons: 0,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: [],
    blocking: false,
    buckets: null,
    leftOrder: IDENT_L,
    rightOrder: IDENT_R,
  });
  // SORT — blocking; rows slide into join-key order
  frames.push({
    phase: 'sort',
    note: 'SORT both sides by join key (blocking — must finish before merging).',
    comparisons: 0,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: [],
    blocking: true,
    buckets: null,
    leftOrder: leftSorted,
    rightOrder: rightSorted,
  });

  // MERGE — two cursors over the sorted arrays
  let i = 0;
  let j = 0;
  while (i < N && j < M) {
    const lo = leftSorted[i];
    const ro = rightSorted[j];
    const lid = USERS[lo].id;
    const rid = ORDERS[ro].uid;
    comparisons++;
    if (lid < rid) {
      frames.push(mergeFrame(`MERGE: ${lid} < ${rid} → advance left`, comparisons, lo, ro, false, emitted, leftSorted, rightSorted));
      i++;
    } else if (lid > rid) {
      frames.push(mergeFrame(`MERGE: ${lid} > ${rid} → advance right`, comparisons, lo, ro, false, emitted, leftSorted, rightSorted));
      j++;
    } else {
      // keys match: emit every right row sharing this key
      let k = j;
      while (k < M && ORDERS[rightSorted[k]].uid === lid) {
        comparisons++;
        emitted.push({ name: USERS[lo].name, item: ORDERS[rightSorted[k]].item });
        frames.push(
          mergeFrame(
            `MERGE: ${lid} = ${ORDERS[rightSorted[k]].uid} ✓ emit ${USERS[lo].name}–${ORDERS[rightSorted[k]].item}`,
            comparisons,
            lo,
            rightSorted[k],
            true,
            emitted,
            leftSorted,
            rightSorted,
          ),
        );
        k++;
      }
      i++;
    }
  }
  frames.push({
    phase: 'done',
    note: `Done. ${comparisons} merge comparisons after sorting; ${emitted.length} rows, already sorted.`,
    comparisons,
    activeLeft: null,
    activeRight: null,
    matchFlash: false,
    emitted: emitted.slice(),
    blocking: false,
    buckets: null,
    leftOrder: leftSorted,
    rightOrder: rightSorted,
  });
  return frames;
}

function mergeFrame(
  note: string,
  comparisons: number,
  activeLeft: number,
  activeRight: number,
  matchFlash: boolean,
  emitted: Pair[],
  leftOrder: number[],
  rightOrder: number[],
): Frame {
  return {
    phase: 'merge',
    note,
    comparisons,
    activeLeft,
    activeRight,
    matchFlash,
    emitted: emitted.slice(),
    blocking: false,
    buckets: null,
    leftOrder,
    rightOrder,
  };
}

/* ------------------------------------------------------------------ */
/*  Mode metadata                                                     */
/* ------------------------------------------------------------------ */

interface ModeInfo {
  key: Mode;
  label: string;
  cost: string;
  build: () => Frame[];
}

const MODES: readonly ModeInfo[] = [
  { key: 'nl', label: 'Nested-loop', cost: 'O(n·m)', build: buildNestedLoop },
  { key: 'hash', label: 'Hash', cost: 'O(n+m)', build: buildHash },
  { key: 'sortmerge', label: 'Sort-merge', cost: 'O(n log n + m log m)', build: buildSortMerge },
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'ready',
  scan: 'scan',
  build: 'build',
  probe: 'probe',
  sort: 'sort',
  merge: 'merge',
  done: 'done',
};

/* ------------------------------------------------------------------ */
/*  Row chip                                                          */
/* ------------------------------------------------------------------ */

const ACCENT = 'var(--color-fig-orange)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';

interface ChipProps {
  k: string | number;
  label: string;
  sub: string;
  active: boolean;
  matched: boolean;
}

function RowChip({ label, sub, active, matched }: ChipProps) {
  const ring = matched ? GREEN : active ? ACCENT : null;
  return (
    <motion.div
      layout
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="font-mono"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 6,
        fontSize: 12.5,
        background: matched ? `${GREEN}1a` : active ? `${ACCENT}14` : 'var(--color-fig-bg)',
        border: `1.5px solid ${ring ?? 'rgba(0,0,0,0.14)'}`,
        color: 'var(--color-fig-fg)',
        boxShadow: ring ? `0 0 0 2px ${ring}26` : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 700, color: ring ?? 'var(--color-fig-muted)' }}>{label}</span>
      <span>{sub}</span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function JoinScene() {
  const [mode, setMode] = useState<Mode>('nl');
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3); // 1 slow … 5 fast

  const frames = useMemo(() => {
    const info = MODES.find((m) => m.key === mode)!;
    return info.build();
  }, [mode]);

  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  // autoplay
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 620 - speed * 100; // speed 1→520ms … 5→120ms
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

  const switchMode = (m: Mode) => {
    setMode(m);
    setIdx(0);
    setPlaying(false);
  };

  const step = () => {
    setPlaying(false);
    setIdx((i) => Math.min(i + 1, frames.length - 1));
  };
  const reset = () => {
    setPlaying(false);
    setIdx(0);
  };
  const togglePlay = () => {
    if (atEnd) {
      setIdx(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  return (
    <Figure
      number="6.3"
      caption="One join, three algorithms, on the same two tables (users ⋈ orders on the user id). Switch modes and watch the work counter: nested-loop runs ~n·m comparisons, hash ~n+m, sort-merge a sort plus one linear merge. Step through, or press play. On a narrow screen the two inputs stack."
    >
      <div className="space-y-4">
        {/* mode switch */}
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => switchMode(m.key)}
              className={`fig-btn ${mode === m.key ? 'fig-btn-primary' : ''}`}
              aria-pressed={mode === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* counters — always above the animation */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-baseline gap-1.5 rounded px-2 py-0.5 text-[12px]"
            style={{ background: 'var(--color-fig-bg)', border: '1px solid rgba(0,0,0,0.10)', color: 'var(--color-fig-muted)' }}
          >
            work
            <span className="font-mono tabular-nums text-[15px] font-bold" style={{ color: ACCENT }}>
              {frame.comparisons}
            </span>
          </span>
          <span
            className="inline-flex items-baseline gap-1.5 rounded px-2 py-0.5 text-[12px]"
            style={{ background: 'var(--color-fig-bg)', border: '1px solid rgba(0,0,0,0.10)', color: 'var(--color-fig-muted)' }}
          >
            rows out
            <span className="font-mono tabular-nums text-[15px] font-bold" style={{ color: GREEN }}>
              {frame.emitted.length}
            </span>
          </span>
          <span
            className="inline-flex items-baseline gap-1.5 rounded px-2 py-0.5 text-[12px]"
            style={{ background: 'var(--color-fig-bg)', border: '1px solid rgba(0,0,0,0.10)', color: 'var(--color-fig-muted)' }}
          >
            cost
            <span className="font-mono text-[12px] font-semibold" style={{ color: BLUE }}>
              {MODES.find((m) => m.key === mode)!.cost}
            </span>
          </span>
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold font-sans"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.blocking ? ACCENT : 'rgba(0,0,0,0.14)'}`,
              color: frame.blocking ? ACCENT : 'var(--color-fig-muted)',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.blocking ? ACCENT : GREEN,
                display: 'inline-block',
              }}
            />
            {PHASE_LABEL[frame.phase]}
            {frame.blocking ? ' · blocking' : ' · pipelined'}
          </span>
        </div>

        {/* the two inputs — side by side on wide, stacked at 390px */}
        <div className="fig-card">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* users */}
            <div className="flex-1 min-w-0">
              <div
                className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--color-fig-muted)' }}
              >
                users <span className="font-normal lowercase">(smaller · n={N})</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {frame.leftOrder.map((oi) => (
                  <RowChip
                    key={`u${oi}`}
                    k={`u${oi}`}
                    label={String(USERS[oi].id)}
                    sub={USERS[oi].name}
                    active={frame.activeLeft === oi}
                    matched={frame.activeLeft === oi && frame.matchFlash}
                  />
                ))}
              </div>
            </div>

            {/* orders */}
            <div className="flex-1 min-w-0">
              <div
                className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--color-fig-muted)' }}
              >
                orders <span className="font-normal lowercase">(larger · m={M})</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {frame.rightOrder.map((ri) => (
                  <RowChip
                    key={`o${ri}`}
                    k={`o${ri}`}
                    label={String(ORDERS[ri].uid)}
                    sub={ORDERS[ri].item}
                    active={frame.activeRight === ri}
                    matched={frame.activeRight === ri && frame.matchFlash}
                  />
                ))}
              </div>
            </div>

            {/* hash buckets panel (hash mode only) */}
            {frame.buckets && (
              <div className="flex-1 min-w-0">
                <div
                  className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-fig-muted)' }}
                >
                  hash table <span className="font-normal lowercase">(on users.id)</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <AnimatePresence initial={false}>
                    {frame.buckets.length === 0 ? (
                      <span
                        className="font-mono text-[12px]"
                        style={{ color: 'var(--color-fig-muted)' }}
                      >
                        (empty — build first)
                      </span>
                    ) : (
                      frame.buckets.map((b) => (
                        <motion.div
                          key={b.key}
                          layout
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="font-mono"
                          style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 6,
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 12.5,
                            background: 'var(--color-fig-bg)',
                            border: '1.5px solid rgba(0,0,0,0.14)',
                            color: 'var(--color-fig-fg)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: BLUE }}>[{b.key}]</span>
                          <span>→ {b.names.join(', ')}</span>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
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
            minHeight: 38,
          }}
        >
          {frame.note}
        </div>

        {/* result list */}
        <div>
          <div
            className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--color-fig-muted)' }}
          >
            join result
          </div>
          <div className="flex flex-wrap gap-1.5" style={{ minHeight: 26 }}>
            <AnimatePresence initial={false}>
              {frame.emitted.length === 0 ? (
                <span className="font-mono text-[12px]" style={{ color: 'var(--color-fig-muted)' }}>
                  (no rows emitted yet)
                </span>
              ) : (
                frame.emitted.map((p, n) => (
                  <motion.span
                    key={`${p.name}-${p.item}-${n}`}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="font-mono text-[12px]"
                    style={{
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: `${GREEN}14`,
                      border: `1px solid ${GREEN}55`,
                      color: 'var(--color-fig-fg)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}–{p.item}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* transport controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="fig-btn fig-btn-primary"
            style={{ minHeight: 38 }}
          >
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          </button>
          <button
            type="button"
            onClick={step}
            disabled={atEnd}
            className="fig-btn"
            style={{ minHeight: 38 }}
          >
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
          <span
            className="font-mono tabular-nums text-[11px]"
            style={{ color: 'var(--color-fig-muted)' }}
          >
            {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* speed */}
        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
