import React from 'react';
import { useMemo, useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure } from '@/components/scene';

/*
 * LockManagerScene — chapter 08, Figure 8.3 (§4).
 *
 * The data structure behind §2/§3: a hash table keyed by resource. Each entry
 * holds a GRANTED SET (who holds the lock, in what mode) and a FIFO WAIT QUEUE
 * (who is blocked, in arrival order). The reader steps through a scripted run
 * and watches entries grant, queue, and drain — a release wakes compatible
 * waiters from the FRONT of the queue (so a burst of readers can wake together,
 * but no one barges ahead of someone who waited longer).
 *
 * The logic here mirrors LOCKMANAGER_SANDBOX exactly (lock / unlock /
 * release_all, S/S compatible, no-barging, FIFO drain).
 */

type Mode = 'S' | 'X';
type Txn = 'T1' | 'T2' | 'T3';

interface Holder { txn: Txn; mode: Mode; }
interface Waiter { txn: Txn; mode: Mode; }
interface Entry { granted: Holder[]; queue: Waiter[]; }
type Table = Record<string, Entry>;

const RESOURCES = ['A', 'B'] as const;

interface Action {
  op: 'lock' | 'unlock' | 'release_all';
  txn: Txn;
  resource?: string;
  mode?: Mode;
}

// The scripted run: grant, queue behind a holder, an S/S batch wakeup on
// release, a second resource, and release_all at commit.
const SCRIPT: readonly Action[] = [
  { op: 'lock', txn: 'T1', resource: 'A', mode: 'X' },
  { op: 'lock', txn: 'T2', resource: 'A', mode: 'S' },
  { op: 'lock', txn: 'T3', resource: 'A', mode: 'S' },
  { op: 'lock', txn: 'T1', resource: 'B', mode: 'X' },
  { op: 'unlock', txn: 'T1', resource: 'A' },
  { op: 'lock', txn: 'T2', resource: 'B', mode: 'S' },
  { op: 'release_all', txn: 'T1' },
] as const;

interface Flash {
  grant?: string;        // `${resource}:${txn}` just granted
  queue?: string;        // just queued
  wake: string[];        // woken (granted from queue)
  unlock?: string;       // released a holder
}

interface Snapshot {
  table: Table;
  message: string;
  tone: 'grant' | 'queue' | 'unlock' | 'wake' | 'start';
  flash: Flash;
}

function emptyTable(): Table {
  const t: Table = {};
  for (const r of RESOURCES) t[r] = { granted: [], queue: [] };
  return t;
}

function clone(t: Table): Table {
  const n: Table = {};
  for (const r of Object.keys(t)) {
    n[r] = { granted: t[r].granted.map((h) => ({ ...h })), queue: t[r].queue.map((w) => ({ ...w })) };
  }
  return n;
}

function compatible(granted: Holder[], txn: Txn, mode: Mode): boolean {
  for (const h of granted) {
    if (h.txn === txn) continue;
    if (mode === 'X' || h.mode === 'X') return false; // S/S only compatible pair
  }
  return true;
}

function drain(entry: Entry, resource: string, wake: string[]) {
  while (entry.queue.length) {
    const head = entry.queue[0];
    if (compatible(entry.granted, head.txn, head.mode)) {
      entry.granted.push({ txn: head.txn, mode: head.mode });
      entry.queue.shift();
      wake.push(`${resource}:${head.txn}`);
    } else {
      break; // stop at first conflict — FIFO, no skipping
    }
  }
}

function apply(prev: Table, a: Action): Snapshot {
  const table = clone(prev);
  const flash: Flash = { wake: [] };
  let message = '';
  let tone: Snapshot['tone'] = 'start';

  if (a.op === 'lock') {
    const r = a.resource!;
    const e = table[r];
    const already = e.granted.find((h) => h.txn === a.txn);
    if (already) {
      message = `${a.txn} already holds ${r}`;
      tone = 'grant';
    } else if (e.queue.length === 0 && compatible(e.granted, a.txn, a.mode!)) {
      e.granted.push({ txn: a.txn, mode: a.mode! });
      flash.grant = `${r}:${a.txn}`;
      message = `GRANT — ${a.txn} takes ${a.mode} on ${r} (compatible, queue empty)`;
      tone = 'grant';
    } else {
      e.queue.push({ txn: a.txn, mode: a.mode! });
      flash.queue = `${r}:${a.txn}`;
      const ahead = e.queue.length > 1
        ? e.queue.slice(0, -1).map((w) => w.txn).join(', ')
        : e.granted.map((h) => h.txn).join(', ');
      message = `QUEUE — ${a.txn} wants ${a.mode} on ${r}, blocked behind ${ahead}`;
      tone = 'queue';
    }
  } else if (a.op === 'unlock') {
    const r = a.resource!;
    const e = table[r];
    e.granted = e.granted.filter((h) => h.txn !== a.txn);
    flash.unlock = `${r}:${a.txn}`;
    drain(e, r, flash.wake);
    message = flash.wake.length
      ? `UNLOCK ${a.txn} on ${r} → wakes ${flash.wake.map((k) => k.split(':')[1]).join(' + ')} from the queue`
      : `UNLOCK ${a.txn} on ${r}`;
    tone = flash.wake.length ? 'wake' : 'unlock';
  } else {
    // release_all — what a committing/aborting transaction calls.
    const woke: string[] = [];
    for (const r of Object.keys(table)) {
      const e = table[r];
      const held = e.granted.some((h) => h.txn === a.txn);
      e.granted = e.granted.filter((h) => h.txn !== a.txn);
      e.queue = e.queue.filter((w) => w.txn !== a.txn);
      if (held) drain(e, r, woke);
    }
    flash.wake = woke;
    flash.unlock = a.txn;
    message = woke.length
      ? `release_all(${a.txn}) → ${a.txn} commits; wakes ${woke.map((k) => k.split(':')[1]).join(' + ')}`
      : `release_all(${a.txn}) → ${a.txn} commits, drops every lock it held`;
    tone = woke.length ? 'wake' : 'unlock';
  }

  return { table, message, tone, flash };
}

const TXN_COLOR: Record<Txn, string> = {
  T1: 'var(--color-fig-blue)',
  T2: 'var(--color-fig-orange)',
  T3: 'var(--color-fig-green)',
};
const TXN_BG: Record<Txn, string> = {
  T1: 'rgba(30,79,165,0.12)',
  T2: 'rgba(176,74,20,0.12)',
  T3: 'rgba(47,107,58,0.12)',
};

function toneColor(tone: Snapshot['tone']): string {
  switch (tone) {
    case 'grant': return 'var(--color-fig-green)';
    case 'queue': return 'var(--color-fig-orange)';
    case 'wake':  return 'var(--color-fig-blue)';
    case 'unlock': return 'var(--color-fig-muted)';
    case 'start': return 'var(--color-fig-muted)';
  }
}

const PLAY_INTERVAL_MS = 1100;

export default function LockManagerScene() {
  // Precompute every snapshot by folding the script. step 0 = initial state.
  const snapshots = useMemo<Snapshot[]>(() => {
    const out: Snapshot[] = [
      { table: emptyTable(), message: 'empty lock table — step through the run', tone: 'start', flash: { wake: [] } },
    ];
    let t = emptyTable();
    for (const a of SCRIPT) {
      const snap = apply(t, a);
      out.push(snap);
      t = snap.table;
    }
    return out;
  }, []);

  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStep = snapshots.length - 1;

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setStep((s) => {
        if (s >= lastStep) {
          if (timerRef.current) clearInterval(timerRef.current);
          setPlaying(false);
          return lastStep;
        }
        return s + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, lastStep]);

  const snap = snapshots[step];
  const nextAction = step < lastStep ? SCRIPT[step] : null;

  const play = () => {
    if (playing) return;
    if (step >= lastStep) setStep(0);
    setPlaying(true);
  };
  const stepFwd = () => {
    setPlaying(false);
    setStep((s) => Math.min(lastStep, s + 1));
  };
  const reset = () => {
    setPlaying(false);
    setStep(0);
  };

  return (
    <Figure
      number="8.3"
      caption="The lock manager: a hash table from resource to a granted set (who holds the lock, colored by mode) and a FIFO wait queue (who is blocked). Step through a run and watch entries grant, queue, and drain — releasing a lock wakes compatible waiters from the front of the queue."
    >
      <div className="space-y-4">
        {/* Next-action / status. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)]">
            step {step} / {lastStep}
          </div>
          {nextAction && (
            <div className="font-mono text-[11px]" style={{ color: 'var(--color-fig-muted)' }}>
              next:{' '}
              <span style={{ color: TXN_COLOR[nextAction.txn], fontWeight: 600 }}>
                {nextAction.op === 'release_all'
                  ? `${nextAction.txn}.release_all()`
                  : `${nextAction.txn}.${nextAction.op}(${nextAction.resource}${nextAction.mode ? `, ${nextAction.mode}` : ''})`}
              </span>
            </div>
          )}
        </div>

        {/* Message. */}
        <div
          className="font-sans text-[12.5px] font-medium leading-snug min-h-[2.4em] rounded-md p-2.5"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: `1px solid ${toneColor(snap.tone)}33`,
            color: toneColor(snap.tone),
          }}
          role="status"
          aria-live="polite"
        >
          {snap.message}
        </div>

        {/* The lock table — one row per resource. */}
        <div className="space-y-2">
          {RESOURCES.map((r) => {
            const e = snap.table[r];
            return (
              <div key={r} className="fig-card rounded-md p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="font-mono text-[13px] font-semibold inline-flex items-center justify-center rounded"
                    style={{
                      width: 24, height: 24,
                      background: 'rgba(30,79,165,0.10)',
                      color: 'var(--color-fig-fg)',
                      border: '1px solid rgba(0,0,0,0.12)',
                    }}
                  >
                    {r}
                  </span>
                  <span className="font-sans text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)]">
                    resource
                  </span>
                </div>

                {/* granted + queue stack on phones, side-by-side ≥520px */}
                <div className="flex flex-col [@media(min-width:520px)]:flex-row gap-2">
                  {/* granted set */}
                  <div className="flex-1 min-w-0">
                    <div className="font-sans text-[9px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)] mb-1">
                      granted set
                    </div>
                    <div className="flex flex-wrap gap-1 min-h-[28px] items-center">
                      <AnimatePresence initial={false}>
                        {e.granted.length === 0 ? (
                          <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                            — free —
                          </span>
                        ) : (
                          e.granted.map((h) => (
                            <Chip
                              key={`g-${r}-${h.txn}`}
                              txn={h.txn}
                              mode={h.mode}
                              held
                              flashing={
                                snap.flash.grant === `${r}:${h.txn}` ||
                                snap.flash.wake.includes(`${r}:${h.txn}`)
                              }
                            />
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* wait queue */}
                  <div className="flex-1 min-w-0 [@media(min-width:520px)]:border-l [@media(min-width:520px)]:border-[color:var(--color-fig-muted)]/20 [@media(min-width:520px)]:pl-2">
                    <div className="font-sans text-[9px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)] mb-1">
                      wait queue · FIFO →
                    </div>
                    <div className="flex flex-wrap gap-1 min-h-[28px] items-center">
                      <AnimatePresence initial={false}>
                        {e.queue.length === 0 ? (
                          <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                            — empty —
                          </span>
                        ) : (
                          e.queue.map((w, qi) => (
                            <Chip
                              key={`q-${r}-${w.txn}`}
                              txn={w.txn}
                              mode={w.mode}
                              held={false}
                              order={qi + 1}
                              flashing={snap.flash.queue === `${r}:${w.txn}`}
                            />
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend. */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-sans text-[10px] text-[color:var(--color-fig-muted)]">
          {(['T1', 'T2', 'T3'] as Txn[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: TXN_COLOR[t] }} />
              {t}
            </span>
          ))}
          <span>· <b>X</b> = exclusive (solid), <b>S</b> = shared (outline)</span>
        </div>

        {/* Controls. */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={play} disabled={playing} className="fig-btn fig-btn-primary">
            ▶ Play
          </button>
          <button type="button" onClick={stepFwd} disabled={step >= lastStep} className="fig-btn">
            ▶| Step
          </button>
          <button type="button" onClick={reset} className="fig-btn">
            ⏮ Reset
          </button>
        </div>
      </div>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */

interface ChipProps {
  txn: Txn;
  mode: Mode;
  held: boolean;
  order?: number;
  flashing?: boolean;
}

function Chip({ txn, mode, held, order, flashing }: ChipProps) {
  const color = TXN_COLOR[txn];
  const exclusive = mode === 'X';
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: held ? 1 : 0.85,
        scale: flashing ? [1, 1.12, 1] : 1,
      }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.3 }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold"
      style={{
        color: exclusive ? '#fff' : color,
        background: exclusive ? color : TXN_BG[txn],
        border: `1.5px solid ${color}`,
      }}
      title={`${txn} holds ${mode === 'X' ? 'exclusive' : 'shared'}${order ? ` (queue position ${order})` : ''}`}
    >
      {order != null && (
        <span className="opacity-70 font-sans text-[8px]">{order}.</span>
      )}
      {txn}
      <span
        className="inline-flex items-center justify-center rounded-sm text-[8px] px-0.5"
        style={{
          background: exclusive ? 'rgba(255,255,255,0.25)' : color,
          color: exclusive ? '#fff' : '#fff',
        }}
      >
        {mode}
      </span>
    </motion.span>
  );
}
