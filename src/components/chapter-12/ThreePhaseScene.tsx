import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * ThreePhaseScene — chapter 12 §7 (Figure 12.4).
 *
 * 3PC vs partitions. Two scenarios chosen by a toggle:
 *
 *   CRASH    — the PRE-COMMIT phase plants "the outcome is commit" in every
 *              participant. The coordinator crashes; the timed-out participants,
 *              all knowing they reached pre-commit, terminate among themselves
 *              and COMMIT with no blocking. The apparent win.
 *
 *   PARTITION — replay it, but drop a partition line down the middle. Group A
 *              received PRE-COMMIT; group B did not. Each group's timeout fires
 *              and each does the locally-correct thing: A commits, B aborts.
 *              Both followed the protocol — and the transaction is TORN.
 *              Split-brain: a SAFETY violation, lit red.
 *
 * The visual argument that 3PC trades blocking for unsafety; the real fix is
 * consensus (§8).
 *
 * Cream palette only. Reflows at 390px: the cluster SVG scrolls, controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

const PARTS = ['P1', 'P2', 'P3', 'P4'] as const;
type Pid = (typeof PARTS)[number];
// group A (P1,P2) = received PRE-COMMIT; group B (P3,P4) = did not (far side of a split)

type PState = 'prepared' | 'pre-commit' | 'committed' | 'aborted';

type Mode = 'crash' | 'partition';

interface Frame {
  phase: string;
  note: string;
  coordDown: boolean;
  partition: boolean; // draw the partition line
  parts: Record<Pid, PState>;
  splitBrain: boolean;
}

const ALL_PREPARED: Record<Pid, PState> = { P1: 'prepared', P2: 'prepared', P3: 'prepared', P4: 'prepared' };

function setAll(v: PState): Record<Pid, PState> {
  return { P1: v, P2: v, P3: v, P4: v };
}

function buildFrames(mode: Mode): Frame[] {
  const frames: Frame[] = [];

  // 0 — votes collected, all prepared
  frames.push({
    phase: 'vote',
    note: 'Phase 1, as in 2PC: the coordinator collects votes. All YES — every participant is prepared.',
    coordDown: false,
    partition: false,
    parts: { ...ALL_PREPARED },
    splitBrain: false,
  });

  if (mode === 'crash') {
    // 1 — PRE-COMMIT to everyone
    frames.push({
      phase: 'pre-commit',
      note: 'Phase 2 — the coordinator broadcasts PRE-COMMIT: “everyone agreed; we are going to commit, get ready.” Each participant now KNOWS the only possible outcome is commit.',
      coordDown: false,
      partition: false,
      parts: setAll('pre-commit'),
      splitBrain: false,
    });
    // 2 — coordinator crashes
    frames.push({
      phase: 'crash',
      note: 'The coordinator crashes before the final COMMIT — exactly the failure that blocked 2PC.',
      coordDown: true,
      partition: false,
      parts: setAll('pre-commit'),
      splitBrain: false,
    });
    // 3 — participants time out and terminate among themselves
    frames.push({
      phase: 'terminate',
      note: 'The participants time out waiting on the silent coordinator. Each reached pre-commit, so each knows the decision was commit — they confer and drive it to a finish WITHOUT the coordinator.',
      coordDown: true,
      partition: false,
      parts: setAll('pre-commit'),
      splitBrain: false,
    });
    // 4 — all commit, no blocking
    frames.push({
      phase: 'done',
      note: 'Every participant commits. No blocking, even though the coordinator died at the fatal 2PC moment. Under a pure crash, 3PC genuinely wins.',
      coordDown: true,
      partition: false,
      parts: setAll('committed'),
      splitBrain: false,
    });
    return frames;
  }

  // PARTITION mode
  // 1 — PRE-COMMIT starts, but the partition splits the cluster
  frames.push({
    phase: 'pre-commit',
    note: 'PRE-COMMIT goes out — but a network partition splits the cluster. Group A (P1, P2) receives it; group B (P3, P4), on the far side of the cut, does not.',
    coordDown: false,
    partition: true,
    parts: { P1: 'pre-commit', P2: 'pre-commit', P3: 'prepared', P4: 'prepared' },
    splitBrain: false,
  });
  // 2 — coordinator unreachable across the split
  frames.push({
    phase: 'crash',
    note: 'The coordinator is gone (or stranded on the far side of the cut). Neither group can reach it — or each other.',
    coordDown: true,
    partition: true,
    parts: { P1: 'pre-commit', P2: 'pre-commit', P3: 'prepared', P4: 'prepared' },
    splitBrain: false,
  });
  // 3 — each group times out and terminates LOCALLY
  frames.push({
    phase: 'terminate',
    note: 'Each group’s timeout fires and each does the locally-correct thing: group A reached pre-commit, so it commits; group B never saw pre-commit, so it aborts. Both followed the protocol.',
    coordDown: true,
    partition: true,
    parts: { P1: 'committed', P2: 'committed', P3: 'aborted', P4: 'aborted' },
    splitBrain: false,
  });
  // 4 — split-brain
  frames.push({
    phase: 'split-brain',
    note: 'The transaction is TORN — committed on one side of the partition, aborted on the other. This is split-brain: a SAFETY violation, worse than blocking. 3PC removes blocking under crashes but is unsafe under partitions. The real fix is consensus (Paxos/Raft) — §8.',
    coordDown: true,
    partition: true,
    parts: { P1: 'committed', P2: 'committed', P3: 'aborted', P4: 'aborted' },
    splitBrain: true,
  });
  return frames;
}

const STATE_COLOR: Record<PState, string> = {
  prepared: BLUE,
  'pre-commit': ORANGE,
  committed: GREEN,
  aborted: RED,
};

/* ------------------------------------------------------------------ */
/*  Cluster SVG                                                        */
/* ------------------------------------------------------------------ */

const W = 380;
const H = 210;
const COORD = { x: W / 2, y: 28 };
const NODE_W = 74;
const NODE_H = 30;

function partPos(i: number) {
  // P1,P2 left half (group A); P3,P4 right half (group B)
  const xs = [70, 150, 230, 310];
  return { x: xs[i], y: 168 };
}

function ClusterSVG({ frame }: { frame: Frame }) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="three-phase commit cluster"
    >
      {/* edges */}
      {PARTS.map((_, i) => {
        const p = partPos(i);
        const dead = frame.coordDown;
        return (
          <line
            key={`e${i}`}
            x1={COORD.x}
            y1={COORD.y + NODE_H / 2}
            x2={p.x}
            y2={p.y - NODE_H / 2}
            stroke={dead ? RED : MUTED}
            strokeOpacity={dead ? 0.35 : 0.3}
            strokeWidth={1.4}
            strokeDasharray={dead ? '4 3' : undefined}
          />
        );
      })}

      {/* partition line down the middle */}
      <AnimatePresence>
        {frame.partition && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <line x1={W / 2} y1={6} x2={W / 2} y2={H - 6} stroke={RED} strokeWidth={2.5} strokeDasharray="6 5" />
            <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={RED} fontFamily="var(--font-sans)" letterSpacing="0.04em">
              ✂ PARTITION
            </text>
            <text x={W / 4} y={150} textAnchor="middle" fontSize={9} fontWeight={700} fill={MUTED} fontFamily="var(--font-sans)">
              group A
            </text>
            <text x={(3 * W) / 4} y={150} textAnchor="middle" fontSize={9} fontWeight={700} fill={MUTED} fontFamily="var(--font-sans)">
              group B
            </text>
          </motion.g>
        )}
      </AnimatePresence>

      {/* coordinator */}
      <g>
        <rect
          x={COORD.x - NODE_W / 2}
          y={COORD.y - NODE_H / 2}
          width={NODE_W}
          height={NODE_H}
          rx={7}
          fill={frame.coordDown ? `${RED}10` : BG}
          stroke={frame.coordDown ? RED : ORANGE}
          strokeWidth={2}
          strokeDasharray={frame.coordDown ? '4 3' : undefined}
        />
        <text x={COORD.x} y={COORD.y + 4} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={frame.coordDown ? RED : FG} fontFamily="ui-monospace, monospace">
          {frame.coordDown ? 'Coord ✕' : 'Coordinator'}
        </text>
      </g>

      {/* participants */}
      {PARTS.map((p, i) => {
        const pos = partPos(i);
        const s = frame.parts[p];
        const color = STATE_COLOR[s];
        const torn = frame.splitBrain;
        return (
          <g key={p}>
            <motion.rect
              x={pos.x - NODE_W / 2}
              y={pos.y - NODE_H / 2}
              width={NODE_W}
              height={NODE_H + 12}
              rx={7}
              fill={`${color}12`}
              stroke={color}
              strokeWidth={2}
              animate={torn ? { strokeWidth: [2, 3, 2] } : { strokeWidth: 2 }}
              transition={torn ? { repeat: Infinity, duration: 1.2 } : { duration: 0.3 }}
            />
            <text x={pos.x} y={pos.y - 2} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={FG} fontFamily="ui-monospace, monospace">
              {p}
            </text>
            <text x={pos.x} y={pos.y + 12} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={color} fontFamily="var(--font-sans)">
              {s}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

const PHASES_3PC = ['vote', 'pre-commit', 'commit'];

export default function ThreePhaseScene() {
  const [mode, setMode] = useState<Mode>('crash');
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const frames = useMemo(() => buildFrames(mode), [mode]);
  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1500);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length]);

  const run = () => {
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
  const setScenario = (m: Mode) => {
    setMode(m);
    setIdx(0);
    setPlaying(false);
  };

  return (
    <Figure
      number="12.4"
      caption="Three-phase commit and its limit. A PRE-COMMIT phase plants “the outcome is commit” in every participant before anyone commits, so a participant left hanging by a crashed coordinator can terminate on its own — no blocking. But replay it with a network partition: group A received PRE-COMMIT and commits; group B did not and aborts. Both followed the protocol, and the transaction is torn — split-brain, a safety violation worse than blocking. 3PC trades blocking for unsafety under partition; the real answer is consensus. Toggle the two scenarios. On a narrow screen the cluster scrolls and controls wrap."
    >
      <div className="space-y-4">
        {/* scenario toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            scenario
          </span>
          <button type="button" onClick={() => setScenario('crash')} className={`fig-btn ${mode === 'crash' ? 'fig-btn-primary' : ''}`} style={{ minHeight: 38 }} aria-pressed={mode === 'crash'}>
            coordinator crash · 3PC wins
          </button>
          <button
            type="button"
            onClick={() => setScenario('partition')}
            className={`fig-btn ${mode === 'partition' ? 'fig-btn-primary' : ''}`}
            style={{ minHeight: 38, borderColor: mode === 'partition' ? undefined : `${RED}88`, color: mode === 'partition' ? undefined : RED }}
            aria-pressed={mode === 'partition'}
          >
            network partition · split-brain
          </button>
        </div>

        {/* phase pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {PHASES_3PC.map((ph) => {
            const active = ph === frame.phase || (ph === 'commit' && (frame.phase === 'terminate' || frame.phase === 'done' || frame.phase === 'split-brain'));
            return (
              <span
                key={ph}
                className="rounded px-2 py-0.5 font-sans text-[10.5px] font-semibold"
                style={{ background: active ? `${ORANGE}1f` : BG, border: `1px solid ${active ? ORANGE : 'rgba(0,0,0,0.12)'}`, color: active ? ORANGE : MUTED }}
              >
                {ph}
              </span>
            );
          })}
          {frame.splitBrain && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              className="ml-1 inline-flex items-center gap-1 rounded px-2 py-0.5 font-sans text-[10.5px] font-bold"
              style={{ background: `${RED}18`, border: `1px solid ${RED}`, color: RED }}
            >
              ⚠ SPLIT-BRAIN
            </motion.span>
          )}
        </div>

        {/* cluster */}
        <div className="fig-card" style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', borderColor: frame.splitBrain ? `${RED}66` : undefined }}>
          <ClusterSVG frame={frame} />
        </div>

        {/* divergent-outcome banner in partition end-state */}
        <AnimatePresence>
          {frame.splitBrain && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="fig-card" style={{ flex: 1, padding: '8px 11px', borderColor: `${GREEN}88` }}>
                <span className="font-sans text-[11px] font-semibold" style={{ color: GREEN }}>
                  group A → committed
                </span>
                <div className="font-mono text-[12px]" style={{ color: FG }}>
                  P1, P2
                </div>
              </div>
              <div className="fig-card" style={{ flex: 1, padding: '8px 11px', borderColor: `${RED}88` }}>
                <span className="font-sans text-[11px] font-semibold" style={{ color: RED }}>
                  group B → aborted
                </span>
                <div className="font-mono text-[12px]" style={{ color: FG }}>
                  P3, P4
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: FG, minHeight: 64 }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={run} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {idx === 0 ? 'Run' : 'Replay'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>
      </div>
    </Figure>
  );
}
