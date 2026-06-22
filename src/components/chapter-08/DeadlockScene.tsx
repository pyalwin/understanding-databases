import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * DeadlockScene — chapter 08 HERO scene (Figure 8.4).
 *
 * The classic A/B–B/A deadlock under (strict) two-phase locking, animated to a
 * deterministic schedule:
 *
 *   T1 locks A (X)            granted
 *   T2 locks B (X)            granted
 *   T1 wants B  -> conflict   T1 WAITS on T2     (wait-for edge T1 -> T2)
 *   T2 wants A  -> conflict   T2 WAITS on T1     (wait-for edge T2 -> T1)
 *   detect      -> CYCLE T1 -> T2 -> T1          deadlock!
 *   abort VICTIM (policy: youngest, or fewest locks held)
 *   survivor wakes, takes the freed lock, holds both, COMMITS
 *   victim retries from the start and proceeds
 *
 * Three live panels share the same frame model: transaction lanes (held locks +
 * what each is blocked on), the resource table (who holds A and B), and the
 * WAIT-FOR GRAPH — a node per transaction, an edge Ti -> Tj when Ti waits for a
 * lock Tj holds. When the two edges close a cycle the graph turns red; the
 * chosen victim flashes, is aborted, and the cycle clears.
 *
 * Cream palette only. Reflows at 390px: the graph scales/scrolls inside the
 * figure, the transaction lanes stack, and the controls wrap full-width.
 */

/* ------------------------------------------------------------------ */
/*  Frame model                                                       */
/* ------------------------------------------------------------------ */

type Tid = 'T1' | 'T2';
type TStatus = 'idle' | 'active' | 'waiting' | 'aborted' | 'committed';

interface TxnState {
  status: TStatus;
  held: string[]; // resources this txn holds an X lock on
  waitingFor: string | null; // resource it is blocked on
}

interface Edge {
  from: Tid;
  to: Tid;
}

interface Frame {
  note: string;
  phase: string;
  t1: TxnState;
  t2: TxnState;
  holders: Record<string, Tid | null>; // resource -> holder
  edges: Edge[];
  cycle: Tid[] | null; // nodes on the detected cycle (highlighted)
  victim: Tid | null;
  detecting: boolean; // detector just ran on this frame
}

const RESOURCES = ['A', 'B'] as const;

const EMPTY_HOLDERS: Record<string, Tid | null> = { A: null, B: null };

function st(
  status: TStatus,
  held: string[] = [],
  waitingFor: string | null = null,
): TxnState {
  return { status, held, waitingFor };
}

/**
 * Build the full frame sequence for a given victim choice. The schedule is
 * fixed (the A/B–B/A interleaving); only *which* transaction gets aborted on
 * detection changes, which is exactly the victim-selection policy decision.
 */
function buildFrames(victim: Tid): Frame[] {
  const survivor: Tid = victim === 'T1' ? 'T2' : 'T1';
  // Each txn holds its "own" resource first: T1↔A, T2↔B.
  const ownOf: Record<Tid, string> = { T1: 'A', T2: 'B' };
  const victimRes = ownOf[victim];
  const survRes = ownOf[survivor];

  const frames: Frame[] = [];

  // 0 — idle
  frames.push({
    note: 'Two transactions, two rows. Press “Trigger deadlock” (or Step) to run the A/B–B/A schedule and watch detection fire.',
    phase: 'idle',
    t1: st('idle'),
    t2: st('idle'),
    holders: { ...EMPTY_HOLDERS },
    edges: [],
    cycle: null,
    victim: null,
    detecting: false,
  });

  // 1 — T1 locks A
  frames.push({
    note: 'T1 acquires an exclusive lock on A — granted, A is free.',
    phase: 'acquire',
    t1: st('active', ['A']),
    t2: st('idle'),
    holders: { A: 'T1', B: null },
    edges: [],
    cycle: null,
    victim: null,
    detecting: false,
  });

  // 2 — T2 locks B
  frames.push({
    note: 'T2 acquires an exclusive lock on B — granted, B is free. No conflict yet.',
    phase: 'acquire',
    t1: st('active', ['A']),
    t2: st('active', ['B']),
    holders: { A: 'T1', B: 'T2' },
    edges: [],
    cycle: null,
    victim: null,
    detecting: false,
  });

  // 3 — T1 wants B → waits on T2
  frames.push({
    note: 'T1 now wants B — but T2 holds it (X/X conflict). T1 blocks and a wait-for edge T1 → T2 appears.',
    phase: 'wait',
    t1: st('waiting', ['A'], 'B'),
    t2: st('active', ['B']),
    holders: { A: 'T1', B: 'T2' },
    edges: [{ from: 'T1', to: 'T2' }],
    cycle: null,
    victim: null,
    detecting: false,
  });

  // 4 — T2 wants A → waits on T1 (cycle closes, not yet detected)
  frames.push({
    note: 'T2 wants A — but T1 holds it. T2 blocks too. The wait-for graph now has T1 → T2 and T2 → T1.',
    phase: 'wait',
    t1: st('waiting', ['A'], 'B'),
    t2: st('waiting', ['B'], 'A'),
    holders: { A: 'T1', B: 'T2' },
    edges: [
      { from: 'T1', to: 'T2' },
      { from: 'T2', to: 'T1' },
    ],
    cycle: null,
    victim: null,
    detecting: false,
  });

  // 5 — detection: cycle highlighted
  frames.push({
    note: 'The detector walks the wait-for graph and finds a cycle: T1 → T2 → T1. Both wait forever — this is a deadlock.',
    phase: 'detect',
    t1: st('waiting', ['A'], 'B'),
    t2: st('waiting', ['B'], 'A'),
    holders: { A: 'T1', B: 'T2' },
    edges: [
      { from: 'T1', to: 'T2' },
      { from: 'T2', to: 'T1' },
    ],
    cycle: ['T1', 'T2'],
    victim: null,
    detecting: true,
  });

  // 6 — victim selected (flash)
  frames.push({
    note: `Pick a victim to break the cycle: ${victim}. Abort it — roll it back and release its locks.`,
    phase: 'victim',
    t1: st('waiting', ['A'], 'B'),
    t2: st('waiting', ['B'], 'A'),
    holders: { A: 'T1', B: 'T2' },
    edges: [
      { from: 'T1', to: 'T2' },
      { from: 'T2', to: 'T1' },
    ],
    cycle: ['T1', 'T2'],
    victim,
    detecting: false,
  });

  // 7 — abort victim → survivor wakes & takes the freed lock
  const survAfter = st('active', [survRes, victimRes].sort());
  const victimAbort = st('aborted');
  frames.push({
    note: `${victim} aborts and releases ${victimRes}. ${survivor} was blocked on ${victimRes} — it wakes, acquires it, and now holds both rows. The cycle is gone.`,
    phase: 'resolve',
    t1: victim === 'T1' ? victimAbort : survAfter,
    t2: victim === 'T2' ? victimAbort : survAfter,
    holders: { [survRes]: survivor, [victimRes]: survivor } as Record<string, Tid | null>,
    edges: [],
    cycle: null,
    victim,
    detecting: false,
  });

  // 8 — survivor commits, releases all
  const victimStill = st('aborted');
  frames.push({
    note: `${survivor} runs to completion and commits, releasing A and B. (Strict 2PL held its X locks right up to commit.)`,
    phase: 'commit',
    t1: victim === 'T1' ? victimStill : st('committed'),
    t2: victim === 'T2' ? victimStill : st('committed'),
    holders: { ...EMPTY_HOLDERS },
    edges: [],
    cycle: null,
    victim,
    detecting: false,
  });

  // 9 — victim retries
  frames.push({
    note: `${victim} retries from the start and now acquires ${victimRes} unobstructed. Deadlock survived: detected, a victim aborted, the survivor finished, the victim retried.`,
    phase: 'done',
    t1: victim === 'T1' ? st('active', ['A']) : st('committed'),
    t2: victim === 'T2' ? st('active', ['B']) : st('committed'),
    holders: { [victimRes]: victim, [survRes]: null } as Record<string, Tid | null>,
    edges: [],
    cycle: null,
    victim: null,
    detecting: false,
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Wait-for graph layout (generic over the txn nodes present)        */
/* ------------------------------------------------------------------ */

const NODES: Tid[] = ['T1', 'T2'];
const GRAPH_H = 150;
const NODE_R = 26;

// Two nodes, side by side, centred in the drawing area.
function nodeCenter(id: Tid, width: number): { x: number; y: number } {
  const i = NODES.indexOf(id);
  const gap = Math.min(150, width - 2 * (NODE_R + 24));
  const cx = width / 2;
  const x = cx + (i === 0 ? -gap / 2 : gap / 2);
  return { x, y: GRAPH_H / 2 };
}

const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

/** A curved arrow from one node to another; reciprocal edges bow opposite ways. */
function edgePath(from: Tid, to: Tid, width: number): { d: string; mx: number; my: number; angle: number } {
  const a = nodeCenter(from, width);
  const b = nodeCenter(to, width);
  // Bow direction: T1→T2 bows up, T2→T1 bows down, so the pair separates.
  const bow = NODES.indexOf(from) < NODES.indexOf(to) ? -1 : 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + bow * 40;
  // Trim the endpoints to the node radius.
  const ang1 = Math.atan2(my - a.y, mx - a.x);
  const ang2 = Math.atan2(my - b.y, mx - b.x);
  const sx = a.x + Math.cos(ang1) * NODE_R;
  const sy = a.y + Math.sin(ang1) * NODE_R;
  const ex = b.x + Math.cos(ang2) * NODE_R;
  const ey = b.y + Math.sin(ang2) * NODE_R;
  const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  const angle = (Math.atan2(ey - my, ex - mx) * 180) / Math.PI;
  return { d, mx: ex, my: ey, angle };
}

interface GraphProps {
  frame: Frame;
}

function WaitForGraph({ frame }: GraphProps) {
  const width = 300; // intrinsic drawing width; scales/scrolls in its container
  const onCycle = (id: Tid) => frame.cycle?.includes(id) ?? false;

  return (
    <svg
      width={width}
      height={GRAPH_H}
      viewBox={`0 0 ${width} ${GRAPH_H}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="wait-for graph"
    >
      <defs>
        <marker id="wf-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill={MUTED} />
        </marker>
        <marker id="wf-arrow-red" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0,0 L9,4.5 L0,9 Z" fill={RED} />
        </marker>
      </defs>

      {/* edges */}
      <AnimatePresence>
        {frame.edges.map((e) => {
          const { d } = edgePath(e.from, e.to, width);
          const red = frame.cycle != null;
          return (
            <motion.path
              key={`${e.from}-${e.to}`}
              initial={{ opacity: 0, pathLength: 0 }}
              animate={{ opacity: 1, pathLength: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.45 }}
              d={d}
              fill="none"
              stroke={red ? RED : MUTED}
              strokeWidth={red ? 2.5 : 1.8}
              markerEnd={`url(#${red ? 'wf-arrow-red' : 'wf-arrow'})`}
            />
          );
        })}
      </AnimatePresence>

      {/* nodes */}
      {NODES.map((id) => {
        const c = nodeCenter(id, width);
        const isVictim = frame.victim === id;
        const cyc = onCycle(id);
        const ring = isVictim ? RED : cyc ? RED : BLUE;
        const fill = isVictim ? `${RED}1f` : 'var(--color-fig-bg)';
        return (
          <g key={id}>
            <motion.circle
              cx={c.x}
              cy={c.y}
              r={NODE_R}
              animate={{
                stroke: ring,
                scale: isVictim && frame.phase === 'victim' ? [1, 1.12, 1] : 1,
              }}
              transition={{ duration: 0.5, repeat: isVictim && frame.phase === 'victim' ? Infinity : 0 }}
              fill={fill}
              strokeWidth={2.2}
            />
            <text
              x={c.x}
              y={c.y + 5}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill={cyc || isVictim ? RED : BLUE}
              fontFamily="ui-monospace, monospace"
            >
              {id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Transaction lane + resource chips                                 */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<TStatus, { label: string; color: string }> = {
  idle: { label: 'idle', color: MUTED },
  active: { label: 'running', color: GREEN },
  waiting: { label: 'blocked', color: ACCENT },
  aborted: { label: 'aborted', color: RED },
  committed: { label: 'committed', color: BLUE },
};

function TxnLane({ id, s }: { id: Tid; s: TxnState }) {
  const meta = STATUS_META[s.status];
  return (
    <motion.div
      layout
      className="fig-card"
      style={{ flex: 1, minWidth: 0, borderColor: `${meta.color}66`, padding: '10px 12px' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-bold" style={{ color: 'var(--color-fig-fg)' }}>
          {id}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold font-sans"
          style={{ background: 'var(--color-fig-bg)', border: `1px solid ${meta.color}`, color: meta.color }}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.color, display: 'inline-block' }} />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] font-sans" style={{ color: MUTED }}>
        <span>holds</span>
        {s.held.length === 0 ? (
          <span className="font-mono" style={{ color: MUTED }}>
            —
          </span>
        ) : (
          s.held.map((r) => (
            <span
              key={r}
              className="font-mono"
              style={{
                padding: '1px 7px',
                borderRadius: 5,
                background: `${GREEN}1a`,
                border: `1px solid ${GREEN}66`,
                color: 'var(--color-fig-fg)',
                fontWeight: 700,
              }}
            >
              {r}(X)
            </span>
          ))
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-sans" style={{ color: MUTED }}>
        <span>waiting on</span>
        {s.waitingFor ? (
          <span
            className="font-mono"
            style={{
              padding: '1px 7px',
              borderRadius: 5,
              background: `${ACCENT}1f`,
              border: `1px solid ${ACCENT}`,
              color: 'var(--color-fig-fg)',
              fontWeight: 700,
            }}
          >
            {s.waitingFor}
          </span>
        ) : (
          <span className="font-mono" style={{ color: MUTED }}>
            —
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function DeadlockScene() {
  const [victim, setVictim] = useState<Tid>('T2'); // default policy: youngest
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frames = useMemo(() => buildFrames(victim), [victim]);
  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 1000 - speed * 130; // speed 1→870ms … 5→350ms
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

  const trigger = () => {
    setIdx(0);
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
  const setPolicy = (v: Tid) => {
    setVictim(v);
    setIdx(0);
    setPlaying(false);
  };

  return (
    <Figure
      number="8.4"
      caption="The classic A/B–B/A deadlock under two-phase locking. T1 holds A and wants B; T2 holds B and wants A — each blocked on a lock the other holds. The wait-for graph (a node per transaction, an edge Ti → Tj when Ti waits for a lock Tj holds) closes a cycle; the detector finds it, a victim is aborted, the survivor finishes, and the victim retries. Choose which transaction to abort. On a narrow screen the lanes stack and the graph scrolls."
    >
      <div className="space-y-4">
        {/* victim policy */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            victim
          </span>
          <button
            type="button"
            onClick={() => setPolicy('T2')}
            className={`fig-btn ${victim === 'T2' ? 'fig-btn-primary' : ''}`}
            aria-pressed={victim === 'T2'}
          >
            T2 · youngest
          </button>
          <button
            type="button"
            onClick={() => setPolicy('T1')}
            className={`fig-btn ${victim === 'T1' ? 'fig-btn-primary' : ''}`}
            aria-pressed={victim === 'T1'}
          >
            T1 · fewest locks
          </button>
        </div>

        {/* phase pill */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.cycle ? RED : 'rgba(0,0,0,0.14)'}`,
              color: frame.cycle ? RED : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.cycle ? RED : frame.phase === 'done' ? GREEN : ACCENT,
                display: 'inline-block',
              }}
            />
            {frame.cycle ? 'deadlock' : frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* wait-for graph */}
        <div
          className="fig-card"
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
        >
          <div
            className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: MUTED }}
          >
            wait-for graph
          </div>
          <WaitForGraph frame={frame} />
        </div>

        {/* transaction lanes — side by side on wide, stacked at 390px */}
        <div className="flex flex-col sm:flex-row gap-3">
          <TxnLane id="T1" s={frame.t1} />
          <TxnLane id="T2" s={frame.t2} />
        </div>

        {/* resource table */}
        <div className="flex flex-wrap gap-2">
          {RESOURCES.map((r) => {
            const holder = frame.holders[r];
            return (
              <span
                key={r}
                className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[12.5px]"
                style={{
                  background: 'var(--color-fig-bg)',
                  border: `1px solid ${holder ? `${GREEN}88` : 'rgba(0,0,0,0.14)'}`,
                  color: 'var(--color-fig-fg)',
                }}
              >
                <span style={{ fontWeight: 700 }}>row {r}</span>
                <span style={{ color: MUTED }}>→</span>
                {holder ? (
                  <span style={{ fontWeight: 700, color: GREEN }}>{holder} (X)</span>
                ) : (
                  <span style={{ color: MUTED }}>free</span>
                )}
              </span>
            );
          })}
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
          {frame.note}
        </div>

        {/* transport controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={trigger} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {idx === 0 ? 'Trigger deadlock' : 'Replay'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
        </div>

        {/* speed */}
        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
