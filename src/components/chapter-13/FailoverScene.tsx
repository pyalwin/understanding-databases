import React from 'react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * FailoverScene — chapter 13 §6 (Figure 13.4, failover).
 *
 * The leader dies; a follower is promoted. Under ASYNC the un-acked tail — records
 * committed-to-the-client but never shipped — simply evaporates when the follower
 * takes over (the LOST TAIL), and if the old leader revives believing it is still
 * leader, you get SPLIT-BRAIN. Under SYNC every committed record was already on the
 * follower at commit time, so promotion loses nothing. Toggle the dial and watch the
 * lost tail appear and disappear at the instant of promotion — §4's trade-off cashed
 * at the one moment that tests it.
 *
 * Cream palette only. Reflows at 390px: the two nodes stack, controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

type Mode = 'sync' | 'async';
type Phase = 'live' | 'promoted';

const KEYS = ['x', 'y', 'z', 'w', 'a', 'b', 'c', 'd'];

interface Rec {
  lsn: number;
  key: string;
  val: string;
}

function Chip({ rec, tone }: { rec: Rec; tone: 'safe' | 'tail' | 'lost' }) {
  const color = tone === 'safe' ? GREEN : tone === 'tail' ? RED : RED;
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={
        tone === 'safe'
          ? { opacity: 0 }
          : { opacity: 0, y: 30, rotate: 10, scale: 0.7, transition: { duration: 0.55, ease: 'easeIn' } }
      }
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className="inline-flex flex-col items-center font-mono"
      style={{
        padding: '3px 7px',
        borderRadius: 6,
        flex: '0 0 auto',
        background: `${color}1a`,
        border: `1px solid ${color}`,
        color: FG,
      }}
    >
      <span className="text-[9px]" style={{ color: MUTED }}>
        lsn {rec.lsn}
      </span>
      <span className="text-[12px] font-bold">
        {rec.key}={rec.val}
      </span>
    </motion.span>
  );
}

export default function FailoverScene() {
  const [mode, setMode] = useState<Mode>('async');
  const [phase, setPhase] = useState<Phase>('live');
  const [followerLog, setFollowerLog] = useState<Rec[]>([]); // records the follower has (safe)
  const [tail, setTail] = useState<Rec[]>([]); // committed-to-client, leader-only (async)
  const [lostTail, setLostTail] = useState<Rec[]>([]);
  const [splitBrain, setSplitBrain] = useState(false);
  const [lsn, setLsn] = useState(0);

  const leaderLog = [...followerLog, ...tail]; // everything the (old) leader holds
  const newLeaderApplied = followerLog.length ? followerLog[followerLog.length - 1].lsn : 0;

  function write() {
    if (phase !== 'live') return;
    const n = lsn + 1;
    const rec: Rec = { lsn: n, key: KEYS[(n - 1) % KEYS.length], val: String(n) };
    setLsn(n);
    if (mode === 'sync') {
      // synchronous: the follower has it before the client is acked
      setFollowerLog((l) => [...l, rec]);
    } else {
      // asynchronous: acked to client, but only on the leader for now
      setTail((t) => [...t, rec]);
    }
  }

  function shipOne() {
    if (phase !== 'live' || tail.length === 0) return;
    const [rec, ...rest] = tail;
    setFollowerLog((l) => [...l, rec]);
    setTail(rest);
  }

  function promote() {
    if (phase !== 'live') return;
    // the promoted follower has only followerLog; the tail (leader-only) is gone
    setLostTail(tail);
    setTail([]);
    setPhase('promoted');
  }

  function revive() {
    setSplitBrain(true);
  }

  function reset() {
    setPhase('live');
    setFollowerLog([]);
    setTail([]);
    setLostTail([]);
    setSplitBrain(false);
    setLsn(0);
  }

  function switchMode(m: Mode) {
    setMode(m);
    reset();
  }

  const promoted = phase === 'promoted';
  const lost = lostTail.length > 0;

  return (
    <Figure
      number="13.4"
      caption="Failover — §4’s trade-off cashed at the one moment that tests it. Pick a mode and commit a few writes, then kill the leader and promote the follower. Under SYNC every committed record was already on the follower, so promotion loses nothing. Under ASYNC the un-acked tail — records the clients were told had committed, but which never left the leader — evaporates the instant the follower takes over: the LOST TAIL. And if the old leader revives still believing it leads, two nodes now accept writes — SPLIT-BRAIN — which real systems prevent by fencing stale leaders with epochs and requiring a majority to elect one. Toggle the dial and watch the lost tail appear and disappear at promotion. On a narrow screen the nodes stack and controls wrap."
    >
      <div className="space-y-4">
        {/* mode dial */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            replication mode
          </span>
          <div className="inline-flex rounded-md overflow-hidden" style={{ border: `1.5px solid ${MUTED}55` }}>
            {(['sync', 'async'] as Mode[]).map((m) => {
              const on = mode === m;
              const col = m === 'sync' ? GREEN : ORANGE;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className="font-sans text-[12px] font-bold"
                  style={{ minHeight: 38, padding: '0 14px', background: on ? col : BG, color: on ? BG : MUTED, border: 'none', cursor: 'pointer' }}
                >
                  {m === 'sync' ? 'synchronous' : 'asynchronous'}
                </button>
              );
            })}
          </div>
        </div>

        {/* outcome banner (after promotion) */}
        <AnimatePresence>
          {promoted && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
              style={{ background: lost ? `${RED}10` : `${GREEN}10`, border: `1.5px solid ${lost ? RED : GREEN}` }}
            >
              <span
                className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold"
                style={{ background: BG, border: `1px solid ${lost ? RED : GREEN}`, color: lost ? RED : GREEN }}
              >
                {lost ? `⚠ lost tail — ${lostTail.length} record${lostTail.length === 1 ? '' : 's'} gone` : '✓ promotion lost nothing'}
              </span>
              <span className="font-sans text-[11.5px] font-semibold" style={{ color: MUTED }}>
                {lost
                  ? 'these were committed-to-client on the old leader, never shipped — silently, permanently gone.'
                  : 'every acknowledged commit was already on the follower at commit time.'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* the two nodes */}
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          {/* OLD LEADER */}
          <div
            className="flex-1 min-w-0 fig-card"
            style={{ padding: '10px 12px', borderColor: promoted ? `${RED}66` : `${BLUE}55`, opacity: promoted ? 0.6 : 1, transition: 'opacity 0.4s' }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-bold" style={{ color: promoted ? RED : BLUE }}>
                {promoted ? '💀 OLD LEADER' : 'LEADER'}
              </span>
              <span className="font-sans text-[10px] font-bold" style={{ color: promoted ? RED : MUTED }}>
                {promoted ? 'dead' : 'accepts writes'}
              </span>
            </div>
            <div className="mt-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              log {!promoted && tail.length > 0 && <span style={{ color: RED }}>· tail leader-only</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5" style={{ minHeight: 38 }}>
              <AnimatePresence mode="popLayout">
                {leaderLog.length === 0 ? (
                  <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-sans text-[12px] italic" style={{ color: MUTED }}>
                    no records yet
                  </motion.span>
                ) : (
                  <>
                    {followerLog.map((r) => (
                      <Chip key={`l-${r.lsn}`} rec={r} tone="safe" />
                    ))}
                    {tail.map((r) => (
                      <Chip key={`t-${r.lsn}`} rec={r} tone="tail" />
                    ))}
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* FOLLOWER / NEW LEADER */}
          <div
            className="flex-1 min-w-0 fig-card"
            style={{ padding: '10px 12px', borderColor: promoted ? `${GREEN}88` : `${GREEN}55` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[13px] font-bold" style={{ color: GREEN }}>
                {promoted ? '👑 NEW LEADER' : 'FOLLOWER'}
              </span>
              <span className="font-mono text-[11px]" style={{ color: MUTED }}>
                applied {newLeaderApplied}
              </span>
            </div>
            <div className="mt-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              log {promoted ? '· now authoritative' : '· replays the stream'}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5" style={{ minHeight: 38 }}>
              <AnimatePresence mode="popLayout">
                {followerLog.length === 0 ? (
                  <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-sans text-[12px] italic" style={{ color: MUTED }}>
                    nothing replayed yet
                  </motion.span>
                ) : (
                  followerLog.map((r) => <Chip key={`f-${r.lsn}`} rec={r} tone="safe" />)
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* lost tail callout */}
        <AnimatePresence>
          {promoted && lost && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="fig-card"
              style={{ padding: '10px 12px', borderColor: `${RED}66`, background: `${RED}08` }}
            >
              <div className="font-sans text-[11px] font-bold uppercase tracking-wide" style={{ color: RED }}>
                lost tail — committed to clients, never replicated
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {lostTail.map((r) => (
                  <span
                    key={r.lsn}
                    className="inline-flex flex-col items-center font-mono line-through"
                    style={{ padding: '3px 7px', borderRadius: 6, background: 'rgba(0,0,0,0.04)', border: `1px dashed ${RED}`, color: MUTED }}
                  >
                    <span className="text-[9px] no-underline">lsn {r.lsn}</span>
                    <span className="text-[12px] font-bold">
                      {r.key}={r.val}
                    </span>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* split-brain warning */}
        <AnimatePresence>
          {splitBrain && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
              style={{ background: `${RED}12`, border: `1.5px solid ${RED}` }}
            >
              <motion.span
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ repeat: Infinity, duration: 1.3 }}
                className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-bold"
                style={{ background: BG, border: `1px solid ${RED}`, color: RED }}
              >
                ⚡ SPLIT-BRAIN
              </motion.span>
              <span className="font-sans text-[11.5px] font-semibold" style={{ color: MUTED }}>
                the old leader revived still believing it leads — two leaders, two divergent logs. Fence it by epoch / require a majority to elect.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          {!promoted ? (
            <>
              <button type="button" className="fig-btn fig-btn-primary" style={{ minHeight: 38 }} onClick={write}>
                commit a write
              </button>
              {mode === 'async' && (
                <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={shipOne} disabled={tail.length === 0}>
                  ship one → follower
                </button>
              )}
              <button
                type="button"
                className="fig-btn fig-btn-danger"
                style={{ minHeight: 38 }}
                onClick={promote}
                disabled={followerLog.length === 0 && tail.length === 0}
              >
                💥 kill leader → promote follower
              </button>
            </>
          ) : (
            <>
              {mode === 'async' && lost && !splitBrain && (
                <button type="button" className="fig-btn fig-btn-danger" style={{ minHeight: 38 }} onClick={revive}>
                  old leader revives
                </button>
              )}
              <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={reset}>
                reset
              </button>
            </>
          )}
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>
            mode {mode} · tail {tail.length}
          </span>
        </div>
      </div>
    </Figure>
  );
}
