import React from 'react';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * LogShippingScene — chapter 13 §2 (Figure 13.1, leader-and-follower).
 *
 * The topology made concrete: a LEADER with a durable log strip ships records,
 * one at a time, across the wire to a FOLLOWER that REPLAYS each into its own
 * copy of the data. The follower's `applied` cursor climbs record by record; it
 * trails the leader and then catches up. "Leader writes +" pushes the leader
 * ahead again so you can watch the follower forever chasing — perpetually
 * recovering. Replaying a record on the follower IS chapter 11's redo, only
 * continuous and remote, with a network in the middle.
 *
 * Cream palette only. Reflows at 390px: leader/follower stack, the SVG wire
 * scrolls, controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

interface Rec {
  lsn: number;
  key: string;
  val: string;
}

// a small, deterministic stream of writes the leader produces
const STREAM: Array<{ key: string; val: string }> = [
  { key: 'x', val: '1' },
  { key: 'y', val: '7' },
  { key: 'x', val: '2' },
  { key: 'z', val: '5' },
  { key: 'y', val: '9' },
  { key: 'x', val: '3' },
  { key: 'w', val: '4' },
  { key: 'z', val: '8' },
];

function applyTo(data: Record<string, string>, recs: Rec[]): Record<string, string> {
  const d = { ...data };
  for (const r of recs) d[r.key] = r.val;
  return d;
}

function LogStrip({
  recs,
  applied,
  label,
  accent,
}: {
  recs: Rec[];
  applied: number;
  label: string;
  accent: string;
}) {
  return (
    <div className="fig-card" style={{ padding: '8px 10px', borderColor: `${accent}55` }}>
      <div
        className="mb-1.5 flex items-center justify-between gap-2 font-sans text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: MUTED }}
      >
        <span>{label} log</span>
        <span className="font-mono normal-case" style={{ color: accent }}>
          applied&nbsp;{applied}
        </span>
      </div>
      <div
        className="flex items-center gap-1.5"
        style={{ overflowX: 'auto', overflowY: 'hidden', minHeight: 34 }}
      >
        <AnimatePresence mode="popLayout">
          {recs.length === 0 ? (
            <motion.span
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-sans text-[12px] italic"
              style={{ color: MUTED }}
            >
              empty — nothing replayed yet
            </motion.span>
          ) : (
            recs.map((r) => {
              const isApplied = r.lsn <= applied;
              return (
                <motion.span
                  key={r.lsn}
                  layout
                  initial={{ opacity: 0, scale: 0.6, x: -10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                  className="inline-flex flex-col items-center font-mono"
                  style={{
                    padding: '3px 7px',
                    borderRadius: 6,
                    flex: '0 0 auto',
                    background: isApplied ? `${accent}1c` : 'rgba(0,0,0,0.03)',
                    border: `1px solid ${isApplied ? accent : 'rgba(0,0,0,0.12)'}`,
                    color: FG,
                  }}
                >
                  <span className="text-[9px]" style={{ color: MUTED }}>
                    lsn&nbsp;{r.lsn}
                  </span>
                  <span className="text-[12px] font-bold">
                    {r.key}={r.val}
                  </span>
                </motion.span>
              );
            })
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DataBox({ data, accent, label, sub }: { data: Record<string, string>; accent: string; label: string; sub: string }) {
  const keys = Object.keys(data).sort();
  return (
    <div className="fig-card" style={{ padding: '8px 10px', borderColor: `${accent}55` }}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold" style={{ color: accent }}>
          {label}
        </span>
        <span className="font-sans text-[10px] font-semibold" style={{ color: MUTED }}>
          {sub}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" style={{ minHeight: 26 }}>
        {keys.length === 0 ? (
          <span className="font-sans text-[12px] italic" style={{ color: MUTED }}>
            {'{}'} — no state yet
          </span>
        ) : (
          keys.map((k) => (
            <motion.span
              key={k}
              layout
              className="font-mono text-[12px]"
              style={{
                padding: '2px 8px',
                borderRadius: 5,
                background: BG,
                border: '1px solid rgba(0,0,0,0.12)',
                color: FG,
              }}
            >
              {k}:{data[k]}
            </motion.span>
          ))
        )}
      </div>
    </div>
  );
}

export default function LogShippingScene() {
  // how many records the leader has produced (its log = STREAM[0..leaderN-1])
  const [leaderN, setLeaderN] = useState(3);
  // how many of those the follower has ingested
  const [followerN, setFollowerN] = useState(0);
  const [shipping, setShipping] = useState(false);

  const leaderRecs: Rec[] = useMemo(
    () => STREAM.slice(0, leaderN).map((r, i) => ({ lsn: i + 1, ...r })),
    [leaderN],
  );
  const followerRecs: Rec[] = useMemo(() => leaderRecs.slice(0, followerN), [leaderRecs, followerN]);

  const leaderApplied = leaderN;
  const followerApplied = followerN;
  const lag = leaderApplied - followerApplied;

  const leaderData = useMemo(() => applyTo({}, leaderRecs), [leaderRecs]);
  const followerData = useMemo(() => applyTo({}, followerRecs), [followerRecs]);

  const inFlight = followerN < leaderN ? leaderRecs[followerN] : null;
  const caughtUp = lag === 0 && leaderN > 0;

  function ship() {
    if (followerN >= leaderN || shipping) return;
    setShipping(true);
    window.setTimeout(() => {
      setFollowerN((n) => n + 1);
      setShipping(false);
    }, 560);
  }

  function leaderWrite() {
    if (leaderN < STREAM.length) setLeaderN((n) => n + 1);
  }

  function reset() {
    setLeaderN(3);
    setFollowerN(0);
    setShipping(false);
  }

  return (
    <Figure
      number="13.1"
      caption="Log shipping — replication is Chapter 11's redo with a network in the middle. The leader produces log records; ship each one across the wire and the follower replays it into its own copy of the data, its applied cursor climbing record by record. Press “ship next” to march a record across; press “leader writes” to push the leader ahead so the follower has to keep chasing. The follower never accepts writes of its own — it is read-only, perpetually recovering from a stream that never ends, always a little behind the leader it follows. On a narrow screen the two nodes stack and the wire scrolls."
    >
      <div className="space-y-4">
        {/* lag banner */}
        <motion.div
          layout
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          animate={{ background: caughtUp ? `${GREEN}10` : `${ORANGE}10` }}
          style={{ border: `1.5px solid ${caughtUp ? GREEN : ORANGE}` }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold"
            style={{ background: BG, border: `1px solid ${caughtUp ? GREEN : ORANGE}`, color: caughtUp ? GREEN : ORANGE }}
          >
            {caughtUp ? '✓ caught up' : `↺ trailing by ${lag}`}
          </span>
          <span className="text-[11.5px] font-semibold" style={{ color: MUTED }}>
            {caughtUp
              ? 'the follower has replayed every record the leader has — for this instant.'
              : `${lag} record${lag === 1 ? '' : 's'} on the leader the follower has not replayed yet.`}
          </span>
        </motion.div>

        {/* leader / wire / follower */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          {/* LEADER */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 font-sans text-[11px] font-bold"
                style={{ background: `${BLUE}1c`, border: `1px solid ${BLUE}`, color: BLUE }}
              >
                LEADER · accepts writes
              </span>
            </div>
            <LogStrip recs={leaderRecs} applied={leaderApplied} label="leader" accent={BLUE} />
            <DataBox data={leaderData} accent={BLUE} label="leader.data" sub="authoritative" />
          </div>

          {/* WIRE */}
          <div
            className="flex sm:flex-col items-center justify-center gap-1 py-1 sm:py-0"
            style={{ minWidth: 92 }}
            aria-hidden="true"
          >
            <svg width={88} height={46} viewBox="0 0 88 46" style={{ maxWidth: '100%', height: 'auto' }}>
              <defs>
                <marker id="ls-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
                  <path d="M0,0 L6,3.5 L0,7 Z" fill={MUTED} />
                </marker>
              </defs>
              <line x1={6} y1={23} x2={78} y2={23} stroke={MUTED} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 4" markerEnd="url(#ls-arrow)" />
              <AnimatePresence>
                {shipping && inFlight && (
                  <motion.g
                    key={inFlight.lsn}
                    initial={{ x: 0, opacity: 0 }}
                    animate={{ x: 64, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    <rect x={2} y={14} width={20} height={18} rx={4} fill={ORANGE} fillOpacity={0.9} />
                    <text x={12} y={26} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--color-fig-bg)" fontFamily="var(--font-mono)">
                      {inFlight.lsn}
                    </text>
                  </motion.g>
                )}
              </AnimatePresence>
            </svg>
            <span className="font-sans text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              replication stream
            </span>
          </div>

          {/* FOLLOWER */}
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 font-sans text-[11px] font-bold"
                style={{ background: `${GREEN}1c`, border: `1px solid ${GREEN}`, color: GREEN }}
              >
                FOLLOWER · read-only
              </span>
            </div>
            <LogStrip recs={followerRecs} applied={followerApplied} label="follower" accent={GREEN} />
            <DataBox
              data={followerData}
              accent={GREEN}
              label="follower.data"
              sub={caughtUp ? 'mirrors leader' : 'catching up'}
            />
          </div>
        </div>

        {/* perpetual-recovery note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: FG, minHeight: 44 }}
        >
          {inFlight ? (
            <>
              Next across the wire: <span className="font-mono font-bold">lsn {inFlight.lsn} · {inFlight.key}={inFlight.val}</span>.
              The follower will <em>append then apply</em> it — redo, exactly as in Chapter 11, only the record arrived over a network instead of off a local disk.
            </>
          ) : (
            <>
              The follower has replayed everything. But a follower is <em>never finished</em> — let the leader write again and the chase resumes. A replica is a node frozen one instant into recovery, for its entire life: <strong>perpetually recovering</strong>.
            </>
          )}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="fig-btn fig-btn-primary"
            style={{ minHeight: 38 }}
            onClick={ship}
            disabled={followerN >= leaderN || shipping}
          >
            ship next record →
          </button>
          <button
            type="button"
            className="fig-btn"
            style={{ minHeight: 38 }}
            onClick={leaderWrite}
            disabled={leaderN >= STREAM.length}
          >
            leader writes +
          </button>
          <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={reset}>
            reset
          </button>
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>
            leader.applied {leaderApplied} · follower.applied {followerApplied}
          </span>
        </div>
      </div>
    </Figure>
  );
}
