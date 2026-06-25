import React from 'react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * LagScene — chapter 13 §5 (Figure 13.3, replication-lag).
 *
 * Asynchronous replication, the follower trailing. A lag meter reads
 * leader.applied − follower.applied. The client writes key x to the LEADER, then
 * reads it back from a stale FOLLOWER — and the read comes up old or empty: the
 * read-your-writes anomaly, the user's own write missing. Advance the stream and
 * watch lag fall to zero and the read snap to correct. Lag is not damage; it is
 * timing — and the figure lets you watch the timing.
 *
 * Cream palette only. Reflows at 390px: panels stack, the stream scrolls,
 * controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

const KEY = 'x'; // the one key the client keeps writing & reading — read-your-writes

interface Rec {
  lsn: number;
  key: string;
  val: string;
}

interface ReadResult {
  followerVal: string | null;
  leaderVal: string;
  stale: boolean;
}

export default function LagScene() {
  // both nodes start in sync at x = 1
  const [leaderData, setLeaderData] = useState<Record<string, string>>({ [KEY]: '1' });
  const [followerData, setFollowerData] = useState<Record<string, string>>({ [KEY]: '1' });
  const [leaderApplied, setLeaderApplied] = useState(1);
  const [followerApplied, setFollowerApplied] = useState(1);
  const [queue, setQueue] = useState<Rec[]>([]); // shipped-but-not-applied (the lag)
  const [lsn, setLsn] = useState(1);
  const [valCounter, setValCounter] = useState(1);
  const [lastWrite, setLastWrite] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);

  const lag = leaderApplied - followerApplied;

  function write() {
    const v = valCounter + 1;
    const n = lsn + 1;
    const rec: Rec = { lsn: n, key: KEY, val: String(v) };
    setValCounter(v);
    setLsn(n);
    setLeaderData((d) => ({ ...d, [KEY]: String(v) }));
    setLeaderApplied(n);
    setQueue((q) => [...q, rec]);
    setLastWrite(String(v));
    setRead(null);
  }

  function advance() {
    if (queue.length === 0) return;
    const [rec, ...rest] = queue;
    setFollowerData((d) => ({ ...d, [rec.key]: rec.val }));
    setFollowerApplied(rec.lsn);
    setQueue(rest);
    setRead(null);
  }

  function readFollower() {
    const fv = followerData[KEY] ?? null;
    const lv = leaderData[KEY];
    setRead({ followerVal: fv, leaderVal: lv, stale: fv !== lv });
  }

  function reset() {
    setLeaderData({ [KEY]: '1' });
    setFollowerData({ [KEY]: '1' });
    setLeaderApplied(1);
    setFollowerApplied(1);
    setQueue([]);
    setLsn(1);
    setValCounter(1);
    setLastWrite(null);
    setRead(null);
  }

  const lagColor = lag === 0 ? GREEN : lag >= 3 ? RED : ORANGE;

  return (
    <Figure
      number="13.3"
      caption="Replication lag and the read-your-writes anomaly. Under asynchronous replication the follower trails the leader; the lag meter reads leader.applied − follower.applied. Write key x to the leader — its value jumps and the record joins the lag queue — then read x back from the follower: while the follower is behind, the read returns an old value (or nothing), the write you just made apparently missing. That is read-your-writes, the sharpest edge of lag. Advance the stream to deliver the queued records and watch lag fall to zero and the follower’s read snap to the leader’s value. The anomaly is not damage; it is timing. On a narrow screen the panels stack and the stream scrolls."
    >
      <div className="space-y-4">
        {/* lag meter */}
        <motion.div
          layout
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          animate={{ background: `${lagColor}10` }}
          style={{ border: `1.5px solid ${lagColor}` }}
        >
          <span className="font-sans text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
            replication lag
          </span>
          <span className="font-mono text-[13px] font-bold" style={{ color: lagColor }}>
            leader.applied {leaderApplied} − follower.applied {followerApplied} = {lag}
          </span>
          <div className="flex-1" />
          <span className="font-sans text-[11.5px] font-semibold" style={{ color: lagColor }}>
            {lag === 0 ? 'follower current' : `follower ${lag} record${lag === 1 ? '' : 's'} behind`}
          </span>
        </motion.div>

        {/* leader / stream / follower */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          {/* leader */}
          <div className="flex-1 min-w-0 fig-card" style={{ padding: '10px 12px', borderColor: `${BLUE}55` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-bold" style={{ color: BLUE }}>
                LEADER
              </span>
              <span className="font-mono text-[11px]" style={{ color: MUTED }}>
                applied {leaderApplied}
              </span>
            </div>
            <div className="mt-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              data
            </div>
            <motion.div
              key={leaderData[KEY]}
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="mt-1 inline-block font-mono text-[15px] font-bold"
              style={{ padding: '4px 12px', borderRadius: 7, background: `${BLUE}1c`, border: `1px solid ${BLUE}`, color: FG }}
            >
              {KEY}:{leaderData[KEY]}
            </motion.div>
          </div>

          {/* stream queue */}
          <div className="flex-1 min-w-0 fig-card" style={{ padding: '10px 12px', borderColor: lag ? `${ORANGE}55` : 'rgba(0,0,0,0.1)' }}>
            <div className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              stream — un-applied records
            </div>
            <div className="mt-2 flex items-center gap-1.5" style={{ overflowX: 'auto', minHeight: 38 }}>
              <AnimatePresence mode="popLayout">
                {queue.length === 0 ? (
                  <motion.span key="drained" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-sans text-[12px] italic" style={{ color: MUTED }}>
                    drained — nothing in flight
                  </motion.span>
                ) : (
                  queue.map((r, i) => (
                    <motion.span
                      key={r.lsn}
                      layout
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, x: 14 }}
                      className="inline-flex flex-col items-center font-mono"
                      style={{
                        padding: '3px 7px',
                        borderRadius: 6,
                        flex: '0 0 auto',
                        background: i === 0 ? `${ORANGE}22` : 'rgba(0,0,0,0.03)',
                        border: `1px solid ${i === 0 ? ORANGE : 'rgba(0,0,0,0.12)'}`,
                        color: FG,
                      }}
                    >
                      <span className="text-[9px]" style={{ color: MUTED }}>
                        lsn {r.lsn}
                      </span>
                      <span className="text-[12px] font-bold">
                        {r.key}={r.val}
                      </span>
                    </motion.span>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* follower */}
          <div className="flex-1 min-w-0 fig-card" style={{ padding: '10px 12px', borderColor: `${GREEN}55` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-bold" style={{ color: GREEN }}>
                FOLLOWER
              </span>
              <span className="font-mono text-[11px]" style={{ color: MUTED }}>
                applied {followerApplied}
              </span>
            </div>
            <div className="mt-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              data {lag > 0 && <span style={{ color: ORANGE }}>· stale</span>}
            </div>
            <motion.div
              key={followerData[KEY]}
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="mt-1 inline-block font-mono text-[15px] font-bold"
              style={{
                padding: '4px 12px',
                borderRadius: 7,
                background: lag > 0 ? `${ORANGE}1c` : `${GREEN}1c`,
                border: `1px solid ${lag > 0 ? ORANGE : GREEN}`,
                color: FG,
              }}
            >
              {KEY}:{followerData[KEY]}
            </motion.div>
          </div>
        </div>

        {/* read-your-writes result */}
        <div style={{ minHeight: 58 }}>
          <AnimatePresence mode="wait">
            {read ? (
              <motion.div
                key={`${read.followerVal}-${read.leaderVal}-${read.stale}`}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-md px-3 py-2 font-sans"
                style={{
                  background: read.stale ? `${RED}10` : `${GREEN}10`,
                  border: `1.5px solid ${read.stale ? RED : GREEN}`,
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold"
                    style={{ background: BG, border: `1px solid ${read.stale ? RED : GREEN}`, color: read.stale ? RED : GREEN }}
                  >
                    {read.stale ? '⚠ read-your-writes anomaly' : '✓ read consistent'}
                  </span>
                  <span className="font-mono text-[12.5px] font-bold" style={{ color: FG }}>
                    read {KEY} from follower → {read.followerVal ?? '∅ (missing)'}
                  </span>
                </div>
                <div className="mt-1.5 font-sans text-[12px]" style={{ color: read.stale ? RED : MUTED }}>
                  {read.stale ? (
                    <>
                      You wrote <span className="font-mono font-bold">{KEY}={read.leaderVal}</span> to the leader, but the follower still shows{' '}
                      <span className="font-mono font-bold">{read.followerVal ?? '∅'}</span> — your own write is missing. Route this read to the leader, or wait for the stream to catch up.
                    </>
                  ) : (
                    <>
                      The follower has applied your write: it returns <span className="font-mono font-bold">{KEY}={read.followerVal}</span>, matching the leader.
                    </>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="prompt"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-md px-3 py-2 font-sans text-[12px] italic"
                style={{ border: '1px dashed rgba(0,0,0,0.15)', color: MUTED }}
              >
                {lastWrite
                  ? `You wrote ${KEY}=${lastWrite} to the leader. Read it back from the follower…`
                  : 'Write a value, then read it back from the follower.'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="fig-btn fig-btn-primary" style={{ minHeight: 38 }} onClick={write}>
            write {KEY} to leader
          </button>
          <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={readFollower}>
            read {KEY} from follower
          </button>
          <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={advance} disabled={queue.length === 0}>
            advance stream →
          </button>
          <button type="button" className="fig-btn fig-btn-danger" style={{ minHeight: 38 }} onClick={reset}>
            reset
          </button>
        </div>
      </div>
    </Figure>
  );
}
