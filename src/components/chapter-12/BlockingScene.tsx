import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * BlockingScene — chapter 12 HERO (Figure 12.2, §5).
 *
 * The blocking problem made visceral. The protocol runs along a timeline of
 * durable milestones; the user drags a CRASH POINT to kill the coordinator at
 * any moment and watch the consequence for the prepared participants:
 *
 *   before PREPARE            crash -> presumed-abort, no locks held       SAFE
 *   PREPARE sent, votes out   crash -> not yet committed to YES, abort     SAFE
 *   all PREPARED (in-doubt)   crash -> locks held, NO decision known       BLOCK ★
 *   decision logged on disk   crash -> participants still don't know it    BLOCK ★
 *   broadcast delivered       crash -> everyone has the verdict, commit    SAFE
 *
 * The middle two crash points are the blocking window: the participants sit
 * in-doubt, locks lit, an in-doubt badge spinning, while other transactions
 * queue behind their held locks with nowhere to go. The figure's whole point is
 * how NARROW that window is, yet how TOTAL its effect.
 *
 * Cream palette only. Reflows at 390px: the timeline scrolls, participants and
 * the queue stack.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

const PARTS = ['P1', 'P2', 'P3'] as const;
type Pid = (typeof PARTS)[number];

type Outcome = 'safe-abort' | 'block' | 'safe-commit';

interface CrashPoint {
  key: string;
  short: string;
  label: string;
  outcome: Outcome;
  // participant state at this crash point
  prepared: boolean; // has each participant force-written 'prepared' / voted YES
  locks: boolean; // are locks held & frozen
  resolved: 'committed' | 'aborted' | 'in-doubt';
  decisionOnDisk: boolean; // did the coordinator's decision survive
  note: string;
}

const CRASH_POINTS: CrashPoint[] = [
  {
    key: 'pre-prepare',
    short: 'before PREPARE',
    label: 'before PREPARE',
    outcome: 'safe-abort',
    prepared: false,
    locks: false,
    resolved: 'aborted',
    decisionOnDisk: false,
    note: 'The coordinator dies before sending PREPARE. No participant ever voted YES or took a lock. Each times out and safely aborts. No harm done.',
  },
  {
    key: 'prepare-sent',
    short: 'PREPARE out',
    label: 'PREPARE sent, votes in flight',
    outcome: 'safe-abort',
    prepared: false,
    locks: false,
    resolved: 'aborted',
    decisionOnDisk: false,
    note: 'PREPARE went out, but the participants have not yet committed to a YES vote. Still free to abort unilaterally, they time out and abort. Safe.',
  },
  {
    key: 'all-prepared',
    short: 'all PREPARED',
    label: 'all PREPARED — in-doubt, locks held',
    outcome: 'block',
    prepared: true,
    locks: true,
    resolved: 'in-doubt',
    decisionOnDisk: false,
    note: 'Every participant has force-written “prepared” and voted YES — in-doubt, holding locks. The coordinator crashes before logging a decision. Commit is unsafe (maybe someone voted NO); abort is unsafe (maybe the coordinator already chose commit). They can do only one safe thing: nothing. They BLOCK.',
  },
  {
    key: 'decided',
    short: 'decision logged',
    label: 'decision logged, not yet broadcast',
    outcome: 'block',
    prepared: true,
    locks: true,
    resolved: 'in-doubt',
    decisionOnDisk: true,
    note: 'The coordinator force-wrote “committed” to its durable log — the commit point survived the crash — but no broadcast went out. The participants still don’t know it. They remain in-doubt, locks held: BLOCKED until the coordinator returns to re-broadcast (that’s §6).',
  },
  {
    key: 'broadcast',
    short: 'broadcast done',
    label: 'broadcast delivered',
    outcome: 'safe-commit',
    prepared: true,
    locks: false,
    resolved: 'committed',
    decisionOnDisk: true,
    note: 'The verdict reached every participant before the coordinator died. Each applied COMMIT, wrote its durable record, and released its locks. A coordinator crash now changes nothing. Safe.',
  },
];

const OUTCOME_META: Record<Outcome, { label: string; color: string; sub: string }> = {
  'safe-abort': { label: 'SAFE — all abort', color: GREEN, sub: 'no locks held, nothing torn' },
  block: { label: 'BLOCKING', color: RED, sub: 'locks held, system stalls' },
  'safe-commit': { label: 'SAFE — all commit', color: GREEN, sub: 'verdict already delivered' },
};

/* ------------------------------------------------------------------ */
/*  Timeline SVG                                                       */
/* ------------------------------------------------------------------ */

const W = 420;
const H = 96;
const PAD = 30;

function tickX(i: number) {
  const span = W - PAD * 2;
  return PAD + (span * i) / (CRASH_POINTS.length - 1);
}

function Timeline({ crash, onPick }: { crash: number; onPick: (i: number) => void }) {
  const lineY = 56;
  // blocking window spans the indices whose outcome is 'block'
  const blockIdx = CRASH_POINTS.map((c, i) => ({ c, i })).filter(({ c }) => c.outcome === 'block').map(({ i }) => i);
  const bStart = tickX(Math.min(...blockIdx)) - 14;
  const bEnd = tickX(Math.max(...blockIdx)) + 14;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="protocol timeline with draggable crash point"
    >
      {/* blocking window band */}
      <rect x={bStart} y={lineY - 22} width={bEnd - bStart} height={44} rx={8} fill={RED} fillOpacity={0.09} stroke={RED} strokeOpacity={0.4} strokeDasharray="4 3" strokeWidth={1.2} />
      <text x={(bStart + bEnd) / 2} y={lineY - 27} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={RED} fontFamily="var(--font-sans)" letterSpacing="0.04em">
        BLOCKING WINDOW
      </text>

      {/* baseline */}
      <line x1={PAD} y1={lineY} x2={W - PAD} y2={lineY} stroke={MUTED} strokeOpacity={0.4} strokeWidth={2} />

      {/* ticks */}
      {CRASH_POINTS.map((c, i) => {
        const x = tickX(i);
        const active = i === crash;
        const col = c.outcome === 'block' ? RED : GREEN;
        return (
          <g key={c.key} style={{ cursor: 'pointer' }} onClick={() => onPick(i)}>
            <circle cx={x} cy={lineY} r={active ? 7 : 5} fill={active ? col : BG} stroke={col} strokeWidth={2} />
            <text x={x} y={lineY + 22} textAnchor="middle" fontSize={8.5} fontWeight={active ? 700 : 500} fill={active ? FG : MUTED} fontFamily="var(--font-sans)">
              {c.short}
            </text>
          </g>
        );
      })}

      {/* crash marker (lightning) */}
      <motion.g animate={{ x: tickX(crash) }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
        <text x={0} y={lineY - 10} textAnchor="middle" fontSize={18}>
          ⚡
        </text>
      </motion.g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Participant card                                                  */
/* ------------------------------------------------------------------ */

function Spinner({ color }: { color: string }) {
  return (
    <motion.span
      aria-hidden="true"
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
      style={{
        width: 11,
        height: 11,
        borderRadius: 99,
        border: `2px solid ${color}`,
        borderTopColor: 'transparent',
        display: 'inline-block',
      }}
    />
  );
}

function ParticipantCard({ id, cp }: { id: Pid; cp: CrashPoint }) {
  const inDoubt = cp.resolved === 'in-doubt';
  const stateColor = inDoubt ? RED : cp.resolved === 'committed' ? GREEN : MUTED;
  const stateLabel = inDoubt ? 'in-doubt' : cp.prepared ? cp.resolved : 'aborted';

  return (
    <motion.div
      layout
      className="fig-card"
      animate={inDoubt ? { boxShadow: [`0 0 0 0px ${RED}00`, `0 0 0 3px ${RED}33`, `0 0 0 0px ${RED}00`] } : { boxShadow: '0 0 0 0px rgba(0,0,0,0)' }}
      transition={inDoubt ? { repeat: Infinity, duration: 1.6 } : { duration: 0.3 }}
      style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderColor: `${stateColor}66` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[14px] font-bold" style={{ color: FG }}>
          {id}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-sans text-[11px] font-semibold"
          style={{ background: BG, border: `1px solid ${stateColor}`, color: stateColor }}
        >
          {inDoubt ? <Spinner color={RED} /> : <span style={{ width: 7, height: 7, borderRadius: 99, background: stateColor, display: 'inline-block' }} />}
          {stateLabel}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 font-sans text-[12px]" style={{ color: MUTED }}>
        <span>locks</span>
        {cp.locks ? (
          <motion.span
            animate={{ opacity: [1, 0.55, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="font-mono"
            style={{ padding: '1px 7px', borderRadius: 5, background: `${ORANGE}1f`, border: `1px solid ${ORANGE}`, color: FG, fontWeight: 700 }}
          >
            🔒 held
          </motion.span>
        ) : (
          <span className="font-mono" style={{ color: cp.resolved === 'committed' ? GREEN : MUTED }}>
            released
          </span>
        )}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function BlockingScene() {
  const [crash, setCrash] = useState(2); // default to the first blocking point — the hero moment
  const cp = CRASH_POINTS[crash];
  const meta = OUTCOME_META[cp.outcome];
  const blocking = cp.outcome === 'block';

  // queued transactions pile up behind held locks only while blocking
  const queueLen = blocking ? 4 : 0;
  const queue = useMemo(() => Array.from({ length: queueLen }, (_, i) => `T${i + 2}`), [queueLen]);

  return (
    <Figure
      number="12.2"
      caption="The blocking problem — two-phase commit’s defining flaw. Drag the crash point along the protocol timeline to kill the coordinator at any moment. Crash it before the prepare phase and everyone safely aborts; crash it after the broadcast and everyone has already committed. But crash it in the one narrow window — after the participants have voted YES (in-doubt, holding locks) and before they learn the decision — and they freeze: locks held, unable to commit or abort alone, while other transactions queue behind their locks. See how narrow that window is, yet how total its effect. On a narrow screen the timeline scrolls and the panels stack."
    >
      <div className="space-y-4">
        {/* outcome banner */}
        <motion.div
          layout
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          animate={{ background: blocking ? `${RED}12` : `${GREEN}10` }}
          style={{ border: `1.5px solid ${meta.color}` }}
        >
          <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold" style={{ background: BG, border: `1px solid ${meta.color}`, color: meta.color }}>
            {blocking ? '⚠ ' : '✓ '}
            {meta.label}
          </span>
          <span className="text-[11.5px] font-semibold" style={{ color: MUTED }}>
            crash @ {cp.label} — {meta.sub}
          </span>
        </motion.div>

        {/* timeline */}
        <div className="fig-card" style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
          <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            protocol timeline — drag the crash ⚡
          </div>
          <Timeline crash={crash} onPick={setCrash} />
        </div>

        {/* crash slider (accessible alternative to dragging the ticks) */}
        <div className="pt-0.5">
          <Slider label="crash point" min={0} max={CRASH_POINTS.length - 1} step={1} value={crash} onChange={setCrash} />
        </div>

        {/* participants */}
        <div className="flex flex-col sm:flex-row gap-3">
          {PARTS.map((p) => (
            <ParticipantCard key={p} id={p} cp={cp} />
          ))}
        </div>

        {/* queued transactions piling up behind held locks */}
        <div className="fig-card" style={{ padding: '10px 12px', borderColor: blocking ? `${RED}55` : 'rgba(0,0,0,0.1)' }}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              other transactions waiting on those locks
            </span>
            <span className="font-mono text-[11px]" style={{ color: blocking ? RED : MUTED }}>
              {queueLen} queued
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ minHeight: 30 }}>
            <AnimatePresence mode="popLayout">
              {queue.length === 0 ? (
                <motion.span key="clear" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-sans text-[12px]" style={{ color: MUTED }}>
                  none — no locks are stuck.
                </motion.span>
              ) : (
                queue.map((t, i) => (
                  <motion.span
                    key={t}
                    layout
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: i * 0.12 }}
                    className="inline-flex items-center gap-1.5 font-mono text-[12px]"
                    style={{ padding: '3px 9px', borderRadius: 6, background: `${RED}12`, border: `1px solid ${RED}66`, color: FG, fontWeight: 700 }}
                  >
                    {t}
                    <span className="font-sans text-[10px] font-semibold" style={{ color: RED }}>
                      blocked
                    </span>
                  </motion.span>
                ))
              )}
            </AnimatePresence>
            {blocking && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-sans text-[11px] italic"
                style={{ color: MUTED }}
              >
                …and the stall spreads outward
              </motion.span>
            )}
          </div>
        </div>

        {/* note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: FG, minHeight: 64 }}
        >
          {cp.note}
        </div>
      </div>
    </Figure>
  );
}
