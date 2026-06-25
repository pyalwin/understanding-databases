import React from 'react';
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * SyncAsyncScene — chapter 13 HERO (Figure 13.2, §4 synchronous-vs-asynchronous).
 *
 * The commit dial made visible. Follow ONE commit under each mode:
 *
 *   SYNC  — the commit ack WAITS for the round trip. Record → follower →
 *           persist+apply → ack back → only THEN the client hears "durable on
 *           2 nodes". The latency clock runs up through every hop; the
 *           vulnerable tail stays empty. Safety bought with time.
 *
 *   ASYNC — the leader fsyncs locally and the client hears "committed" the
 *           INSTANT the leader's log is durable. The record drops into a queue
 *           that lives only on the leader — the vulnerable tail — and grows with
 *           every commit until something drains it. Speed bought with a window
 *           of loss.
 *
 * The defining image: the commit-latency gauge and the vulnerable-tail gauge
 * move OPPOSITE each other. That inversion is the entire chapter.
 *
 * Cream palette only. Reflows at 390px: the node row scrolls, gauges stack,
 * controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

type Mode = 'sync' | 'async';
type Lit = 'client' | 'leader' | 'follower' | 'wire-out' | 'wire-back' | null;

interface Rec {
  lsn: number;
  key: string;
  val: string;
}

const KEYS = ['x', 'y', 'z', 'w', 'a', 'b', 'c', 'd'];
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

function NodeBox({
  title,
  sub,
  accent,
  lit,
  glow,
}: {
  title: string;
  sub: string;
  accent: string;
  lit: boolean;
  glow: string;
}) {
  return (
    <motion.div
      className="fig-card"
      animate={{
        boxShadow: lit ? `0 0 0 3px ${glow}55` : '0 0 0 0px rgba(0,0,0,0)',
        borderColor: lit ? glow : `${accent}55`,
      }}
      transition={{ duration: 0.25 }}
      style={{ flex: '1 1 0', minWidth: 96, padding: '10px 12px', textAlign: 'center' }}
    >
      <div className="font-mono text-[13px] font-bold" style={{ color: accent }}>
        {title}
      </div>
      <div className="mt-0.5 font-sans text-[10.5px] font-semibold" style={{ color: MUTED }}>
        {sub}
      </div>
    </motion.div>
  );
}

function Gauge({
  label,
  pct,
  text,
  color,
  hint,
}: {
  label: string;
  pct: number;
  text: string;
  color: string;
  hint: string;
}) {
  return (
    <div className="fig-card" style={{ flex: '1 1 0', minWidth: 150, padding: '10px 12px' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          {label}
        </span>
        <span className="font-mono text-[13px] font-bold" style={{ color }}>
          {text}
        </span>
      </div>
      <div
        className="mt-2 rounded-full"
        style={{ height: 10, background: 'rgba(0,0,0,0.06)', overflow: 'hidden' }}
      >
        <motion.div
          animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          style={{ height: '100%', background: color, borderRadius: 999 }}
        />
      </div>
      <div className="mt-1.5 font-sans text-[11px]" style={{ color: MUTED }}>
        {hint}
      </div>
    </div>
  );
}

export default function SyncAsyncScene() {
  const [mode, setMode] = useState<Mode>('sync');
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState<Lit>(null);
  const [latency, setLatency] = useState(0); // ms of the most recent commit path
  const [tail, setTail] = useState<Rec[]>([]); // committed-to-client, leader-only
  const [followerApplied, setFollowerApplied] = useState(0);
  const [clientMsg, setClientMsg] = useState<{ text: string; tone: 'green' | 'red' } | null>(null);
  const [note, setNote] = useState('Pick a mode and commit a write. Watch where — and when — the client hears “committed.”');
  const [inFlight, setInFlight] = useState<{ rec: Rec; dir: 'out' | 'back' } | null>(null);

  const lsnRef = useRef(0);
  const runningRef = useRef(false);

  const nextRec = (): Rec => {
    lsnRef.current += 1;
    const n = lsnRef.current;
    return { lsn: n, key: KEYS[(n - 1) % KEYS.length], val: String(n) };
  };

  async function commit() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const rec = nextRec();

    if (mode === 'sync') {
      setLit('leader');
      setLatency(5);
      setClientMsg(null);
      setNote('Leader fsyncs the record durably to its own log — the local cost, ~5 ms.');
      await sleep(520);

      setLit('wire-out');
      setInFlight({ rec, dir: 'out' });
      setLatency(45);
      setNote('Now it WAITS: the record ships across the wire to the follower…');
      await sleep(620);

      setInFlight(null);
      setLit('follower');
      setFollowerApplied(rec.lsn);
      setLatency(55);
      setNote('The follower persists + applies the record, then sends its acknowledgement.');
      await sleep(520);

      setLit('wire-back');
      setInFlight({ rec, dir: 'back' });
      setLatency(95);
      setNote('The ack travels all the way back to the leader. The commit is still not done.');
      await sleep(620);

      setInFlight(null);
      setLit('client');
      setLatency(95);
      setClientMsg({ text: `commit lsn ${rec.lsn}: durable on 2 nodes`, tone: 'green' });
      setNote('Only NOW does the client hear “committed.” Safe — the write is on two machines — but the wait was a full network round trip.');
    } else {
      setLit('leader');
      setLatency(5);
      setClientMsg(null);
      setNote('Leader fsyncs the record durably to its own log — the local cost, ~5 ms.');
      await sleep(480);

      setLit('client');
      setLatency(5);
      setTail((t) => [...t, rec]);
      setClientMsg({ text: `commit lsn ${rec.lsn}: durable on leader only (async)`, tone: 'red' });
      setNote('Instantly the client hears “committed” — fast. But the record lives on ONE machine. It joins the vulnerable tail, waiting to ship.');
    }

    setRunning(false);
    runningRef.current = false;
  }

  async function drain() {
    if (runningRef.current || tail.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    setClientMsg(null);
    // ship each queued record to the follower in the background
    let queue = [...tail];
    while (queue.length > 0) {
      const rec = queue[0];
      setLit('wire-out');
      setInFlight({ rec, dir: 'out' });
      setNote(`Background: queued lsn ${rec.lsn} finally crosses the wire to the follower.`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(520);
      setInFlight(null);
      setLit('follower');
      setFollowerApplied(rec.lsn);
      queue = queue.slice(1);
      setTail(queue);
      // eslint-disable-next-line no-await-in-loop
      await sleep(180);
    }
    setLit(null);
    setNote('Tail drained — the follower has caught up. But every record sat leader-only until this moment.');
    setRunning(false);
    runningRef.current = false;
  }

  function switchMode(m: Mode) {
    if (runningRef.current) return;
    setMode(m);
    setLit(null);
    setInFlight(null);
    setClientMsg(null);
    setLatency(0);
    setNote(
      m === 'sync'
        ? 'SYNC: the commit will wait for the follower’s ack before telling the client. Safe, but slow.'
        : 'ASYNC: the commit returns the instant the leader is durable. Fast, but a tail lives only on the leader.',
    );
  }

  function reset() {
    if (runningRef.current) return;
    setTail([]);
    setFollowerApplied(0);
    setLatency(0);
    setLit(null);
    setInFlight(null);
    setClientMsg(null);
    lsnRef.current = 0;
    setNote('Reset. Pick a mode and commit a write.');
  }

  const latencyColor = latency > 40 ? ORANGE : latency > 0 ? GREEN : MUTED;
  const tailColor = tail.length > 0 ? RED : GREEN;

  return (
    <Figure
      number="13.2"
      caption="Synchronous vs asynchronous replication — the dial the whole chapter turns on. Flip the mode and commit a write, then follow it. In SYNC the commit ack waits for the full round trip — record to the follower, persist, ack back — and only then does the client hear “durable on 2 nodes”; the latency gauge climbs while the vulnerable tail stays empty. In ASYNC the client hears “committed” the instant the leader’s log is durable, while the record drops into a queue that lives only on the leader; the latency gauge barely moves while the tail grows with every commit. The two gauges move opposite each other — latency versus a window of loss — and that inversion is the entire chapter. On a narrow screen the node row scrolls and the gauges stack."
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
                  disabled={running}
                  className="font-sans text-[12px] font-bold"
                  style={{
                    minHeight: 38,
                    padding: '0 14px',
                    background: on ? col : BG,
                    color: on ? BG : MUTED,
                    border: 'none',
                    cursor: running ? 'default' : 'pointer',
                  }}
                >
                  {m === 'sync' ? 'synchronous' : 'asynchronous'}
                </button>
              );
            })}
          </div>
        </div>

        {/* node row: client — leader — follower */}
        <div
          className="flex items-stretch gap-2 sm:gap-3"
          style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 2 }}
        >
          <NodeBox title="CLIENT" sub="awaits commit" accent={FG} lit={lit === 'client'} glow={clientMsg?.tone === 'red' ? RED : GREEN} />
          <div className="flex items-center" aria-hidden="true" style={{ flex: '0 0 auto' }}>
            <svg width={44} height={40} viewBox="0 0 44 40" style={{ maxWidth: '100%', height: 'auto' }}>
              <line x1={4} y1={20} x2={40} y2={20} stroke={MUTED} strokeOpacity={0.5} strokeWidth={2} />
            </svg>
          </div>
          <NodeBox title="LEADER" sub="durable first" accent={BLUE} lit={lit === 'leader'} glow={BLUE} />
          {/* wire with in-flight record */}
          <div className="flex items-center" aria-hidden="true" style={{ flex: '0 0 auto' }}>
            <svg width={60} height={40} viewBox="0 0 60 40" style={{ maxWidth: '100%', height: 'auto' }}>
              <line x1={4} y1={14} x2={56} y2={14} stroke={MUTED} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 4" />
              <line x1={4} y1={28} x2={56} y2={28} stroke={MUTED} strokeOpacity={0.3} strokeWidth={1.5} strokeDasharray="2 4" />
              <text x={30} y={11} textAnchor="middle" fontSize={6.5} fill={MUTED} fontFamily="var(--font-sans)">ship</text>
              <text x={30} y={38} textAnchor="middle" fontSize={6.5} fill={MUTED} fontFamily="var(--font-sans)">ack</text>
              <AnimatePresence>
                {inFlight && (
                  <motion.g
                    key={`${inFlight.rec.lsn}-${inFlight.dir}`}
                    initial={{ x: inFlight.dir === 'out' ? 0 : 38, opacity: 0 }}
                    animate={{ x: inFlight.dir === 'out' ? 38 : 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeInOut' }}
                  >
                    <rect x={2} y={inFlight.dir === 'out' ? 7 : 21} width={16} height={13} rx={3} fill={inFlight.dir === 'out' ? ORANGE : GREEN} />
                    <text x={10} y={inFlight.dir === 'out' ? 16 : 30} textAnchor="middle" fontSize={7} fontWeight={700} fill="var(--color-fig-bg)" fontFamily="var(--font-mono)">
                      {inFlight.rec.lsn}
                    </text>
                  </motion.g>
                )}
              </AnimatePresence>
            </svg>
          </div>
          <NodeBox title="FOLLOWER" sub={`applied ${followerApplied}`} accent={GREEN} lit={lit === 'follower'} glow={GREEN} />
        </div>

        {/* client verdict */}
        <div style={{ minHeight: 40 }}>
          <AnimatePresence mode="wait">
            {clientMsg ? (
              <motion.div
                key={clientMsg.text}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
                style={{
                  background: clientMsg.tone === 'green' ? `${GREEN}10` : `${RED}10`,
                  border: `1.5px solid ${clientMsg.tone === 'green' ? GREEN : RED}`,
                }}
              >
                <span className="font-sans text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
                  client hears
                </span>
                <span className="font-mono text-[12.5px] font-bold" style={{ color: clientMsg.tone === 'green' ? GREEN : RED }}>
                  {clientMsg.text}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-md px-3 py-2 font-sans text-[12px] italic"
                style={{ border: '1px dashed rgba(0,0,0,0.15)', color: MUTED }}
              >
                {running ? 'committing…' : 'client has heard nothing yet'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* opposing gauges */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Gauge
            label="commit latency"
            pct={latency}
            text={`${latency} ms`}
            color={latencyColor}
            hint={mode === 'sync' ? 'pays the network round trip' : 'just the local fsync'}
          />
          <Gauge
            label="vulnerable tail"
            pct={tail.length * 22}
            text={`${tail.length} rec${tail.length === 1 ? '' : 's'}`}
            color={tailColor}
            hint={tail.length === 0 ? 'nothing lives leader-only' : 'committed-to-client, on the leader ONLY'}
          />
        </div>

        {/* tail contents */}
        <div className="fig-card" style={{ padding: '8px 10px', borderColor: tail.length ? `${RED}55` : 'rgba(0,0,0,0.1)' }}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
              queue — records on the leader, not yet on the follower
            </span>
            <span className="font-mono text-[11px]" style={{ color: tail.length ? RED : MUTED }}>
              {tail.length} queued
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" style={{ minHeight: 28 }}>
            <AnimatePresence mode="popLayout">
              {tail.length === 0 ? (
                <motion.span key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-sans text-[12px] italic" style={{ color: MUTED }}>
                  empty — every committed record is on both nodes.
                </motion.span>
              ) : (
                tail.map((r) => (
                  <motion.span
                    key={r.lsn}
                    layout
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="inline-flex items-center gap-1 font-mono text-[12px]"
                    style={{ padding: '3px 8px', borderRadius: 6, background: `${RED}12`, border: `1px solid ${RED}66`, color: FG, fontWeight: 700 }}
                  >
                    <span className="text-[9px]" style={{ color: RED }}>lsn {r.lsn}</span>
                    {r.key}={r.val}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: FG, minHeight: 52 }}
        >
          {note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="fig-btn fig-btn-primary" style={{ minHeight: 38 }} onClick={commit} disabled={running}>
            commit a write
          </button>
          {mode === 'async' && (
            <button type="button" className="fig-btn" style={{ minHeight: 38 }} onClick={drain} disabled={running || tail.length === 0}>
              drain tail → follower
            </button>
          )}
          <button type="button" className="fig-btn fig-btn-danger" style={{ minHeight: 38 }} onClick={reset} disabled={running}>
            reset
          </button>
        </div>
      </div>
    </Figure>
  );
}
