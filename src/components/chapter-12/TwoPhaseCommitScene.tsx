import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * TwoPhaseCommitScene — chapter 12 §3 (Figure 12.1).
 *
 * The two-phase commit protocol, animated. A coordinator drives three
 * participants through:
 *
 *   PHASE 1  PREPARE  ->  each participant force-writes 'prepared', votes YES
 *                         (or votes NO and aborts locally)
 *   DECIDE            ->  coordinator force-writes the verdict to its durable
 *                         log — committed iff UNANIMOUS yes. THIS record is the
 *                         commit point.
 *   PHASE 2  BROADCAST->  COMMIT/ABORT delivered to every prepared participant,
 *                         which applies it, logs it, releases its locks, acks.
 *
 * Interactive: flip any participant's vote to NO and watch the global outcome
 * flip to ABORT — no torn state, every node ends in the same verdict. Each
 * node's durable log fills in as the protocol runs.
 *
 * Mirrors the canonical model exactly: Participant.log records {tid,st} with
 * st in new|prepared|committed|aborted; Coordinator.log holds the decision.
 *
 * Cream palette only. Reflows at 390px: the topology SVG scales/scrolls and the
 * node logs stack.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

const PARTS = ['P1', 'P2', 'P3'] as const;
type Pid = (typeof PARTS)[number];

type RecSt = 'prepared' | 'committed' | 'aborted';

interface PartState {
  log: RecSt[];
  locks: boolean;
}

interface Msg {
  i: number; // participant index
  dir: 'down' | 'up';
  label: string;
  color: string;
}

interface Frame {
  phase: string;
  note: string;
  coordLog: ('committed' | 'aborted')[];
  commitPoint: boolean; // highlight the coordinator's decision record
  parts: Record<Pid, PartState>;
  msgs: Msg[];
}

const RECORD_COLOR: Record<string, string> = {
  prepared: BLUE,
  committed: GREEN,
  aborted: RED,
};

function partStatus(s: PartState): 'new' | RecSt {
  return s.log.length ? s.log[s.log.length - 1] : 'new';
}

function buildFrames(votes: Record<Pid, boolean>): Frame[] {
  const verdict: 'committed' | 'aborted' = PARTS.every((p) => votes[p])
    ? 'committed'
    : 'aborted';

  const empty = (): Record<Pid, PartState> => ({
    P1: { log: [], locks: false },
    P2: { log: [], locks: false },
    P3: { log: [], locks: false },
  });

  const frames: Frame[] = [];

  // 0 — idle
  frames.push({
    phase: 'idle',
    note: 'A coordinator and three participants, each with its own durable log. Flip a vote to NO, then run the protocol.',
    coordLog: [],
    commitPoint: false,
    parts: empty(),
    msgs: [],
  });

  // 1 — PHASE 1: PREPARE sent
  frames.push({
    phase: 'prepare',
    note: 'Phase 1 — the coordinator sends PREPARE to every participant: “can you commit this transaction?”',
    coordLog: [],
    commitPoint: false,
    parts: empty(),
    msgs: PARTS.map((_, i) => ({ i, dir: 'down' as const, label: 'PREPARE', color: BLUE })),
  });

  // 2 — votes returned
  const voted = empty();
  PARTS.forEach((p) => {
    if (votes[p]) {
      voted[p] = { log: ['prepared'], locks: true }; // WAL: durable BEFORE voting YES
    } else {
      voted[p] = { log: ['aborted'], locks: false }; // vote NO -> abort locally
    }
  });
  frames.push({
    phase: 'vote',
    note: 'Each participant does the work, holds its locks, force-writes a durable “prepared” record, and votes YES — or votes NO and aborts its half locally.',
    coordLog: [],
    commitPoint: false,
    parts: voted,
    msgs: PARTS.map((p, i) => ({
      i,
      dir: 'up' as const,
      label: votes[p] ? 'YES' : 'NO',
      color: votes[p] ? GREEN : RED,
    })),
  });

  // 3 — DECIDE: coordinator force-writes the verdict
  frames.push({
    phase: 'decide',
    note:
      verdict === 'committed'
        ? 'Unanimous YES. The coordinator force-writes “committed” to its durable log — this record is the commit point. The fate is now sealed.'
        : 'A NO vote breaks unanimity. The coordinator force-writes “aborted” to its durable log. Atomicity is all-or-nothing.',
    coordLog: [verdict],
    commitPoint: true,
    parts: voted,
    msgs: [],
  });

  // 4 — PHASE 2: broadcast verdict to prepared participants
  const preparedIdx = PARTS.map((p, i) => ({ p, i })).filter(
    ({ p }) => partStatus(voted[p]) === 'prepared',
  );
  frames.push({
    phase: 'broadcast',
    note:
      verdict === 'committed'
        ? 'Phase 2 — the coordinator broadcasts COMMIT to every prepared participant.'
        : 'Phase 2 — the coordinator broadcasts ABORT to every prepared participant. Nobody committed; nothing is torn.',
    coordLog: [verdict],
    commitPoint: true,
    parts: voted,
    msgs: preparedIdx.map(({ i }) => ({
      i,
      dir: 'down' as const,
      label: verdict === 'committed' ? 'COMMIT' : 'ABORT',
      color: verdict === 'committed' ? GREEN : RED,
    })),
  });

  // 5 — apply + ack
  const applied = empty();
  PARTS.forEach((p) => {
    if (partStatus(voted[p]) === 'prepared') {
      applied[p] = { log: [...voted[p].log, verdict], locks: false };
    } else {
      applied[p] = { log: [...voted[p].log], locks: false };
    }
  });
  frames.push({
    phase: 'apply',
    note: 'Each prepared participant applies the verdict, writes its own durable record, releases its locks, and acknowledges.',
    coordLog: [verdict],
    commitPoint: true,
    parts: applied,
    msgs: preparedIdx.map(({ i }) => ({ i, dir: 'up' as const, label: 'ack', color: MUTED })),
  });

  // 6 — done
  frames.push({
    phase: 'done',
    note:
      verdict === 'committed'
        ? 'Done. Every node ended “committed” — atomic commit across machines, decided at one durable instant.'
        : 'Done. Every node ended “aborted” — all-or-nothing held, no node left in a different state from the others.',
    coordLog: [verdict],
    commitPoint: false,
    parts: applied,
    msgs: [],
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Topology SVG                                                      */
/* ------------------------------------------------------------------ */

const W = 360;
const H = 196;
const COORD = { x: W / 2, y: 30 };
const NODE_W = 78;
const NODE_H = 30;

function partPos(i: number) {
  return { x: 56 + i * 124, y: 158 };
}

function Topology({ frame }: { frame: Frame }) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="two-phase commit message topology"
    >
      {/* edges */}
      {PARTS.map((_, i) => {
        const p = partPos(i);
        return (
          <line
            key={`e${i}`}
            x1={COORD.x}
            y1={COORD.y + NODE_H / 2}
            x2={p.x}
            y2={p.y - NODE_H / 2}
            stroke={MUTED}
            strokeOpacity={0.3}
            strokeWidth={1.4}
          />
        );
      })}

      {/* travelling messages */}
      <AnimatePresence>
        {frame.msgs.map((m) => {
          const p = partPos(m.i);
          const from = m.dir === 'down' ? { x: COORD.x, y: COORD.y + NODE_H / 2 } : { x: p.x, y: p.y - NODE_H / 2 };
          const to = m.dir === 'down' ? { x: p.x, y: p.y - NODE_H / 2 } : { x: COORD.x, y: COORD.y + NODE_H / 2 };
          const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
          return (
            <g key={`${frame.phase}-${m.i}-${m.dir}`}>
              <motion.circle
                r={5}
                fill={m.color}
                initial={{ cx: from.x, cy: from.y, opacity: 0 }}
                animate={{ cx: to.x, cy: to.y, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: 'easeInOut' }}
              />
              <motion.text
                x={mid.x + 9}
                y={mid.y + 3}
                fontSize={10}
                fontWeight={700}
                fill={m.color}
                fontFamily="ui-monospace, monospace"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: 0.25 }}
              >
                {m.label}
              </motion.text>
            </g>
          );
        })}
      </AnimatePresence>

      {/* coordinator node */}
      <g>
        <rect
          x={COORD.x - NODE_W / 2}
          y={COORD.y - NODE_H / 2}
          width={NODE_W}
          height={NODE_H}
          rx={7}
          fill={BG}
          stroke={ORANGE}
          strokeWidth={2}
        />
        <text x={COORD.x} y={COORD.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={FG} fontFamily="ui-monospace, monospace">
          Coordinator
        </text>
      </g>

      {/* participant nodes */}
      {PARTS.map((p, i) => {
        const pos = partPos(i);
        const status = partStatus(frame.parts[p]);
        const color = status === 'new' ? MUTED : RECORD_COLOR[status];
        return (
          <g key={p}>
            <rect
              x={pos.x - NODE_W / 2}
              y={pos.y - NODE_H / 2}
              width={NODE_W}
              height={NODE_H}
              rx={7}
              fill={BG}
              stroke={color}
              strokeWidth={2}
            />
            <text x={pos.x} y={pos.y - 1} textAnchor="middle" fontSize={12} fontWeight={700} fill={FG} fontFamily="ui-monospace, monospace">
              {p}
            </text>
            {frame.parts[p].locks && (
              <text x={pos.x} y={pos.y + 11} textAnchor="middle" fontSize={8.5} fontWeight={700} fill={ORANGE} fontFamily="var(--font-sans)">
                🔒 locks
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Log panel                                                         */
/* ------------------------------------------------------------------ */

function LogPanel({ title, records, accent, commitPoint }: { title: string; records: string[]; accent: string; commitPoint?: boolean }) {
  return (
    <div className="fig-card" style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderColor: `${accent}55` }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold" style={{ color: FG }}>
          {title}
        </span>
        <span className="font-sans text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          durable log
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" style={{ minHeight: 24 }}>
        {records.length === 0 ? (
          <span className="font-mono text-[12px]" style={{ color: MUTED }}>
            —
          </span>
        ) : (
          records.map((r, idx) => {
            const isDecision = commitPoint && idx === records.length - 1;
            const c = RECORD_COLOR[r] ?? MUTED;
            return (
              <motion.span
                key={`${r}-${idx}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-mono text-[11.5px]"
                style={{
                  padding: '1px 7px',
                  borderRadius: 5,
                  background: `${c}1a`,
                  border: `1px solid ${isDecision ? c : `${c}66`}`,
                  color: FG,
                  fontWeight: 700,
                  boxShadow: isDecision ? `0 0 0 2px ${c}55` : undefined,
                }}
              >
                {r}
                {isDecision && r === 'committed' ? ' ★' : ''}
              </motion.span>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

const PHASES = ['prepare', 'vote', 'decide', 'broadcast', 'apply'];

export default function TwoPhaseCommitScene() {
  const [votes, setVotes] = useState<Record<Pid, boolean>>({ P1: true, P2: true, P3: true });
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const frames = useMemo(() => buildFrames(votes), [votes]);
  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;
  const verdict: 'committed' | 'aborted' = PARTS.every((p) => votes[p]) ? 'committed' : 'aborted';

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
    }, 1050);
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
  const toggleVote = (p: Pid) => {
    setVotes((v) => ({ ...v, [p]: !v[p] }));
    setIdx(0);
    setPlaying(false);
  };

  const phaseIdx = PHASES.indexOf(frame.phase);

  return (
    <Figure
      number="12.1"
      caption="Two-phase commit across a coordinator and three participants. Phase 1: PREPARE goes out, each participant force-writes a “prepared” record and votes YES (or votes NO and aborts). The coordinator force-writes the verdict to its durable log — the commit point — then phase 2 broadcasts COMMIT/ABORT, which each prepared participant applies and acknowledges. Flip any vote to NO and the global outcome flips to ABORT, with no torn state. On a narrow screen the topology scrolls and the logs stack."
    >
      <div className="space-y-4">
        {/* votes */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            votes
          </span>
          {PARTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggleVote(p)}
              className="fig-btn"
              style={{
                minHeight: 38,
                borderColor: votes[p] ? `${GREEN}88` : `${RED}88`,
                color: votes[p] ? GREEN : RED,
                fontWeight: 700,
              }}
              aria-pressed={votes[p]}
            >
              {p}: {votes[p] ? 'YES' : 'NO'}
            </button>
          ))}
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-sans text-[11px] font-semibold"
            style={{ background: BG, border: `1px solid ${verdict === 'committed' ? GREEN : RED}`, color: verdict === 'committed' ? GREEN : RED }}
          >
            global → {verdict}
          </span>
        </div>

        {/* phase pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {PHASES.map((ph, i) => {
            const active = ph === frame.phase;
            const done = phaseIdx > i;
            return (
              <span
                key={ph}
                className="rounded px-2 py-0.5 font-sans text-[10.5px] font-semibold"
                style={{
                  background: active ? `${ORANGE}1f` : BG,
                  border: `1px solid ${active ? ORANGE : done ? `${GREEN}66` : 'rgba(0,0,0,0.12)'}`,
                  color: active ? ORANGE : done ? GREEN : MUTED,
                }}
              >
                {ph}
              </span>
            );
          })}
        </div>

        {/* topology */}
        <div className="fig-card" style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
          <Topology frame={frame} />
        </div>

        {/* logs */}
        <div className="flex flex-col sm:flex-row gap-3">
          <LogPanel title="Coordinator" records={frame.coordLog} accent={ORANGE} commitPoint={frame.commitPoint} />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          {PARTS.map((p) => (
            <LogPanel key={p} title={p} records={frame.parts[p].log} accent={partStatus(frame.parts[p]) === 'new' ? MUTED : RECORD_COLOR[partStatus(frame.parts[p]) as RecSt]} />
          ))}
        </div>

        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: FG, minHeight: 52 }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={run} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {idx === 0 ? 'Run protocol' : 'Replay'}
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
