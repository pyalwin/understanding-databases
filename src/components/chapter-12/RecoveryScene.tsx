import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * RecoveryScene — chapter 12 §6 (Figure 12.3).
 *
 * Recovery from the blocking crash. Picks up where Figure 12.2 left off: the
 * participants frozen in-doubt, the coordinator dead. The coordinator restarts
 * and reads its DECISION LOG — the single source of truth — and resolves every
 * in-doubt participant from that one durable fact.
 *
 * Two cases, chosen by a toggle (did the coordinator force a decision before
 * dying?):
 *   committed-on-disk  ->  re-broadcast COMMIT; in-doubt participants commit,
 *                          release locks.
 *   no-decision        ->  PRESUMED ABORT: recovery writes 'aborted' and
 *                          broadcasts it.
 *
 * A participant is shown QUERYING the coordinator ("verdict for tid?"), and a
 * re-delivered message bounces harmlessly off an already-committed participant —
 * recovery is idempotent (run recover() twice, the second is a no-op).
 *
 * Mirrors Coordinator.recover() and Participant.finish()/status() exactly.
 *
 * Cream palette only. Reflows at 390px.
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

type PStatus = 'prepared' | 'committed' | 'aborted';
type CoordStatus = 'down' | 'restarting' | 'reading' | 'up';

interface Frame {
  phase: string;
  note: string;
  coord: CoordStatus;
  coordLog: ('committed' | 'aborted')[];
  parts: Record<Pid, { status: PStatus; locks: boolean }>;
  query: Pid | null; // a participant asking the coordinator
  bounce: Pid | null; // an idempotent re-delivery bouncing off an already-applied participant
}

function buildFrames(decided: boolean): Frame[] {
  const verdict: 'committed' | 'aborted' = decided ? 'committed' : 'aborted';
  const inDoubt = (): Record<Pid, { status: PStatus; locks: boolean }> => ({
    P1: { status: 'prepared', locks: true },
    P2: { status: 'prepared', locks: true },
    P3: { status: 'prepared', locks: true },
  });

  const frames: Frame[] = [];

  // 0 — the blocking aftermath
  frames.push({
    phase: 'blocked',
    note: 'Where Figure 12.2 left us: every participant in-doubt, locks held, the coordinator dead. Nothing moves until it returns.',
    coord: 'down',
    coordLog: decided ? ['committed'] : [],
    parts: inDoubt(),
    query: null,
    bounce: null,
  });

  // 1 — an in-doubt participant queries (cooperative termination)
  frames.push({
    phase: 'query',
    note: 'A participant that has waited too long takes the initiative: it asks the coordinator directly — “what was the verdict for this transaction?”',
    coord: 'down',
    coordLog: decided ? ['committed'] : [],
    parts: inDoubt(),
    query: 'P1',
    bounce: null,
  });

  // 2 — coordinator restarts
  frames.push({
    phase: 'restart',
    note: 'The coordinator restarts and prepares to recover — it does not guess and it does not poll. It reads its own durable decision log.',
    coord: 'restarting',
    coordLog: decided ? ['committed'] : [],
    parts: inDoubt(),
    query: null,
    bounce: null,
  });

  // 3 — reads the decision log
  frames.push({
    phase: 'read',
    note: decided
      ? 'recover() reads the decision log and finds a “committed” record — the commit point survived the crash. The verdict is COMMIT.'
      : 'recover() reads the decision log and finds NO decision record. By the presumed-abort convention, the absence of a record means the verdict is ABORT — and recovery writes “aborted” now.',
    coord: 'reading',
    coordLog: decided ? ['committed'] : ['aborted'],
    parts: inDoubt(),
    query: null,
    bounce: null,
  });

  // 4 — re-broadcast verdict to in-doubt participants
  frames.push({
    phase: 'rebroadcast',
    note: decided
      ? 'The coordinator re-broadcasts COMMIT to every still-prepared participant.'
      : 'The coordinator broadcasts ABORT to every still-prepared participant.',
    coord: 'up',
    coordLog: decided ? ['committed'] : ['aborted'],
    parts: inDoubt(),
    query: null,
    bounce: null,
  });

  // 5 — participants apply, release locks
  const applied: Record<Pid, { status: PStatus; locks: boolean }> = {
    P1: { status: verdict, locks: false },
    P2: { status: verdict, locks: false },
    P3: { status: verdict, locks: false },
  };
  frames.push({
    phase: 'applied',
    note: decided
      ? 'Each in-doubt participant applies COMMIT, writes its durable record, and releases its locks. The blockage clears — the spreading paralysis of §5 undone.'
      : 'Each in-doubt participant applies ABORT, writes its durable record, and releases its locks. Cleanly resolved, no torn state.',
    coord: 'up',
    coordLog: decided ? ['committed'] : ['aborted'],
    parts: applied,
    query: null,
    bounce: null,
  });

  // 6 — idempotent second recover(): re-delivery bounces off
  frames.push({
    phase: 'idempotent',
    note: 'Run recover() a SECOND time (say the coordinator crashed again mid-cleanup). It re-reads the same decision log and re-delivers — but a participant that already applied the verdict sees it in its own log and ignores the repeat. The re-delivery bounces off. No value is double-applied.',
    coord: 'up',
    coordLog: decided ? ['committed'] : ['aborted'],
    parts: applied,
    query: null,
    bounce: 'P2',
  });

  return frames;
}

const STATUS_COLOR: Record<PStatus, string> = {
  prepared: RED,
  committed: GREEN,
  aborted: MUTED,
};

const COORD_META: Record<CoordStatus, { label: string; color: string }> = {
  down: { label: 'DOWN', color: RED },
  restarting: { label: 'restarting…', color: ORANGE },
  reading: { label: 'reading log', color: BLUE },
  up: { label: 'up', color: GREEN },
};

/* ------------------------------------------------------------------ */

function ParticipantCard({ id, p, query, bounce }: { id: Pid; p: { status: PStatus; locks: boolean }; query: boolean; bounce: boolean }) {
  const inDoubt = p.status === 'prepared';
  const color = STATUS_COLOR[p.status];
  return (
    <motion.div
      layout
      className="fig-card"
      animate={inDoubt ? { boxShadow: [`0 0 0 0px ${RED}00`, `0 0 0 3px ${RED}30`, `0 0 0 0px ${RED}00`] } : { boxShadow: '0 0 0 0px rgba(0,0,0,0)' }}
      transition={inDoubt ? { repeat: Infinity, duration: 1.6 } : { duration: 0.3 }}
      style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderColor: `${color}66`, position: 'relative' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-bold" style={{ color: FG }}>
          {id}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-sans text-[11px] font-semibold" style={{ background: BG, border: `1px solid ${color}`, color }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: color, display: 'inline-block' }} />
          {inDoubt ? 'in-doubt' : p.status}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans text-[12px]" style={{ color: MUTED }}>
        <span>locks</span>
        {p.locks ? (
          <span className="font-mono" style={{ padding: '1px 7px', borderRadius: 5, background: `${ORANGE}1f`, border: `1px solid ${ORANGE}`, color: FG, fontWeight: 700 }}>
            🔒 held
          </span>
        ) : (
          <span className="font-mono" style={{ color: p.status === 'committed' ? GREEN : MUTED }}>
            released
          </span>
        )}
      </div>
      <AnimatePresence>
        {query && (
          <motion.span
            key="q"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute -top-2 right-2 font-sans text-[10px] font-semibold"
            style={{ padding: '2px 7px', borderRadius: 6, background: BG, border: `1px solid ${BLUE}`, color: BLUE }}
          >
            “verdict for tid?” →
          </motion.span>
        )}
        {bounce && (
          <motion.span
            key="b"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, x: [0, 6, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute -top-2 right-2 font-sans text-[10px] font-semibold"
            style={{ padding: '2px 7px', borderRadius: 6, background: BG, border: `1px solid ${MUTED}`, color: MUTED }}
          >
            re-deliver → no-op ↩
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */

export default function RecoveryScene() {
  const [decided, setDecided] = useState(true);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const frames = useMemo(() => buildFrames(decided), [decided]);
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
  const setCase = (d: boolean) => {
    setDecided(d);
    setIdx(0);
    setPlaying(false);
  };

  const cm = COORD_META[frame.coord];

  return (
    <Figure
      number="12.3"
      caption="Recovering 2PC. The coordinator restarts and reads its durable decision log — the single source of truth. If a “committed” record is there, it re-broadcasts and the in-doubt participants commit and drop their locks; if there is no decision record, presumed-abort resolves them instead. A participant queries the coordinator for the verdict, and a re-delivered message bounces harmlessly off an already-committed participant — recovery is idempotent, so running it twice changes nothing. Toggle whether the coordinator logged a decision before crashing. On a narrow screen the panels stack."
    >
      <div className="space-y-4">
        {/* case toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            before the crash, the coordinator
          </span>
          <button type="button" onClick={() => setCase(true)} className={`fig-btn ${decided ? 'fig-btn-primary' : ''}`} style={{ minHeight: 38 }} aria-pressed={decided}>
            logged “committed”
          </button>
          <button type="button" onClick={() => setCase(false)} className={`fig-btn ${!decided ? 'fig-btn-primary' : ''}`} style={{ minHeight: 38 }} aria-pressed={!decided}>
            logged nothing → presumed abort
          </button>
        </div>

        {/* coordinator + decision log */}
        <div className="fig-card" style={{ padding: '10px 12px', borderColor: `${cm.color}66` }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[14px] font-bold" style={{ color: FG }}>
              Coordinator
            </span>
            <span className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-sans text-[11px] font-semibold" style={{ background: BG, border: `1px solid ${cm.color}`, color: cm.color }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: cm.color, display: 'inline-block' }} />
              {cm.label}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans text-[12px]" style={{ color: MUTED }}>
            <span>decision log</span>
            {frame.coordLog.length === 0 ? (
              <span className="font-mono" style={{ color: MUTED }}>
                — (empty → presumed abort)
              </span>
            ) : (
              frame.coordLog.map((r, i) => {
                const c = r === 'committed' ? GREEN : RED;
                return (
                  <motion.span
                    key={`${r}-${i}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="font-mono"
                    style={{ padding: '1px 8px', borderRadius: 5, background: `${c}1a`, border: `1px solid ${c}`, color: FG, fontWeight: 700 }}
                  >
                    {r} ★
                  </motion.span>
                );
              })
            )}
            <span className="ml-1 font-sans text-[10.5px] italic" style={{ color: MUTED }}>
              source of truth
            </span>
          </div>
        </div>

        {/* participants */}
        <div className="flex flex-col sm:flex-row gap-3">
          {PARTS.map((p) => (
            <ParticipantCard key={p} id={p} p={frame.parts[p]} query={frame.query === p} bounce={frame.bounce === p} />
          ))}
        </div>

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
            {idx === 0 ? 'Run recover()' : 'Replay'}
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
