import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * GroupCommitScene — chapter 10 scene (Figure 10.1, §2).
 *
 * Transactions arrive on a timeline and pile into a COMMIT BATCH (the WAL
 * buffer). When the batch is full one fsync fires and durably commits the whole
 * group at once — N commits paid for with a single expensive disk sync. A
 * batch-size control shows the trade: bigger batches multiply throughput while
 * each transaction waits longer for its group to flush.
 *
 * Deterministic frame sequence (like ch08's DeadlockScene): N transactions
 * arrive one per frame; every `batch` arrivals an fsync frame flushes the group
 * to the durable "disk" lane. Cost model mirrors the §1/§2 sandboxes:
 *   throughput = commits / (fsyncs * FSYNC_MS)   -> climbs ~x batch
 *   latency    = batch * ARRIVAL_MS / 2 + FSYNC_MS -> rises with batch
 *
 * Cream palette only. Reflows at 390px: the three lanes stack (flex-col
 * sm:flex-row), chips wrap, the tradeoff bars and controls wrap full-width.
 */

/* ------------------------------------------------------------------ */
/*  Cost model + palette                                              */
/* ------------------------------------------------------------------ */

const N_TXNS = 12; // transactions in the demo run
const FSYNC_MS = 5.0; // one fsync ~5 ms (the disk sync — unchanged by batching)
const ARRIVAL_MS = 2.0; // a txn arrives ~every 2 ms under load (scene illustration)
const BATCH_SIZES = [1, 2, 4, 8] as const;

const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

function throughputOf(batch: number, commits = 1000): number {
  const fsyncs = Math.ceil(commits / batch);
  return commits / ((fsyncs * FSYNC_MS) / 1000);
}
function latencyOf(batch: number): number {
  return (batch * ARRIVAL_MS) / 2 + FSYNC_MS;
}
const MAX_TPUT = throughputOf(BATCH_SIZES[BATCH_SIZES.length - 1]);
const MAX_LAT = latencyOf(BATCH_SIZES[BATCH_SIZES.length - 1]);

/* ------------------------------------------------------------------ */
/*  Frame model                                                       */
/* ------------------------------------------------------------------ */

type Phase = 'idle' | 'arrive' | 'fsync' | 'done';

interface Frame {
  note: string;
  phase: Phase;
  pending: number[]; // txn ids not yet arrived
  batch: number[]; // txn ids appended, waiting for fsync (the WAL buffer)
  durable: number[]; // txn ids fsync'd to disk (committed)
  fsyncs: number;
  justArrived: number | null;
  flushing: boolean; // an fsync just fired on this frame
}

function buildFrames(batchSize: number): Frame[] {
  const ids = Array.from({ length: N_TXNS }, (_, i) => i + 1);
  const frames: Frame[] = [];

  const pending = [...ids];
  let batch: number[] = [];
  const durable: number[] = [];
  let fsyncs = 0;

  frames.push({
    note: `Each transaction appends its log record to the commit batch; one fsync commits the whole batch at once. Batch size ${batchSize}. Press “Run” or Step.`,
    phase: 'idle',
    pending: [...pending],
    batch: [],
    durable: [],
    fsyncs: 0,
    justArrived: null,
    flushing: false,
  });

  while (pending.length > 0) {
    const t = pending.shift()!;
    batch.push(t);
    frames.push({
      note: `T${t} arrives and appends to the WAL buffer — fast (just bytes), but NOT durable yet. Batch ${batch.length}/${batchSize}.`,
      phase: 'arrive',
      pending: [...pending],
      batch: [...batch],
      durable: [...durable],
      fsyncs,
      justArrived: t,
      flushing: false,
    });

    if (batch.length >= batchSize) {
      fsyncs += 1;
      const flushed = [...batch];
      durable.push(...flushed);
      batch = [];
      frames.push({
        note: `fsync! One disk sync (~${FSYNC_MS}ms) durably commits the whole group of ${flushed.length}: T${flushed.join(', T')}. ${flushed.length} commits, 1 fsync.`,
        phase: 'fsync',
        pending: [...pending],
        batch: [],
        durable: [...durable],
        fsyncs,
        justArrived: null,
        flushing: true,
      });
    }
  }

  // final partial batch
  if (batch.length > 0) {
    fsyncs += 1;
    const flushed = [...batch];
    durable.push(...flushed);
    batch = [];
    frames.push({
      note: `Final fsync flushes the last partial batch of ${flushed.length}: T${flushed.join(', T')}.`,
      phase: 'fsync',
      pending: [],
      batch: [],
      durable: [...durable],
      fsyncs,
      justArrived: null,
      flushing: true,
    });
  }

  frames.push({
    note: `Done. ${N_TXNS} transactions committed with ${fsyncs} fsync${fsyncs === 1 ? '' : 's'} — vs ${N_TXNS} fsyncs the naive way. Bigger batches → fewer syncs → more throughput, at the cost of per-commit latency.`,
    phase: 'done',
    pending: [],
    batch: [],
    durable: [...durable],
    fsyncs,
    justArrived: null,
    flushing: false,
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Chip                                                              */
/* ------------------------------------------------------------------ */

function TxnChip({ id, tone }: { id: number; tone: 'pending' | 'batch' | 'durable' }) {
  const style =
    tone === 'pending'
      ? { bg: 'var(--color-fig-bg)', border: 'rgba(0,0,0,0.16)', fg: MUTED }
      : tone === 'batch'
        ? { bg: `${ACCENT}1f`, border: ACCENT, fg: 'var(--color-fig-fg)' }
        : { bg: `${BLUE}1a`, border: `${BLUE}88`, fg: 'var(--color-fig-fg)' };
  return (
    <motion.span
      layout
      layoutId={`txn-${id}`}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className="font-mono text-[12px] font-bold"
      style={{
        padding: '2px 8px',
        borderRadius: 6,
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.fg,
        whiteSpace: 'nowrap',
      }}
    >
      T{id}
    </motion.span>
  );
}

function Lane({
  title,
  hint,
  color,
  children,
  flash,
}: {
  title: string;
  hint: string;
  color: string;
  children: React.ReactNode;
  flash?: boolean;
}) {
  return (
    <motion.div
      layout
      className="fig-card"
      style={{
        flex: 1,
        minWidth: 0,
        padding: '10px 12px',
        borderColor: flash ? color : `${color}55`,
        boxShadow: flash ? `0 0 0 2px ${color}55` : undefined,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[11px] font-bold uppercase tracking-wide" style={{ color }}>
          {title}
        </span>
        <span className="font-sans text-[10.5px]" style={{ color: MUTED }}>
          {hint}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" style={{ minHeight: 30 }}>
        {children}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tradeoff bars                                                     */
/* ------------------------------------------------------------------ */

function Bar({ label, value, max, suffix, color }: { label: string; value: number; max: number; suffix: string; color: string }) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between font-sans text-[11px]" style={{ color: MUTED }}>
        <span>{label}</span>
        <span className="font-mono tabular-nums font-semibold" style={{ color: 'var(--color-fig-fg)' }}>
          {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          {suffix}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: 'rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        <motion.div
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 220, damping: 30 }}
          style={{ height: '100%', background: color, borderRadius: 99 }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function GroupCommitScene() {
  const [batchSize, setBatchSize] = useState<number>(4);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frames = useMemo(() => buildFrames(batchSize), [batchSize]);
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
  const pickBatch = (b: number) => {
    setBatchSize(b);
    setIdx(0);
    setPlaying(false);
  };

  const tput = throughputOf(batchSize);
  const lat = latencyOf(batchSize);
  const naiveFsyncs = N_TXNS;

  return (
    <Figure
      number="10.1"
      caption="Group commit. Transactions arrive and append their log records to a commit batch — fast, but not yet durable. When the batch fills, a single fsync forces the whole group to disk at once, committing all of them with one expensive sync. The batch-size control shows the trade: a larger batch means fewer fsyncs and far higher throughput, but each transaction waits longer for its group to flush. On a narrow screen the lanes stack and the chips wrap."
    >
      <div className="space-y-4">
        {/* batch-size selector */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            batch size
          </span>
          {BATCH_SIZES.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => pickBatch(b)}
              className={`fig-btn ${batchSize === b ? 'fig-btn-primary' : ''}`}
              aria-pressed={batchSize === b}
              style={{ minHeight: 38 }}
            >
              {b}
            </button>
          ))}
        </div>

        {/* tradeoff bars — the whole point, derived from batch size */}
        <div
          className="fig-card grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3"
          style={{ padding: '12px 14px' }}
        >
          <Bar label="throughput" value={tput} max={MAX_TPUT} suffix=" commits/s" color={GREEN} />
          <Bar label="commit latency" value={lat} max={MAX_LAT} suffix=" ms" color={ACCENT} />
          <div className="sm:col-span-2 font-sans text-[11.5px] leading-snug" style={{ color: MUTED }}>
            batch <span className="font-mono font-bold" style={{ color: 'var(--color-fig-fg)' }}>{batchSize}</span>:
            throughput climbs ~×{batchSize}; each commit waits a little longer for its group. Throughput rises faster
            than latency — that is the bargain.
          </div>
        </div>

        {/* phase pill + step counter */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.flushing ? GREEN : 'rgba(0,0,0,0.14)'}`,
              color: frame.flushing ? GREEN : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.flushing ? GREEN : frame.phase === 'arrive' ? ACCENT : MUTED,
                display: 'inline-block',
              }}
            />
            {frame.phase === 'fsync' ? 'fsync' : frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            fsyncs {frame.fsyncs}
            <span style={{ opacity: 0.6 }}> / naive {naiveFsyncs}</span>
          </span>
        </div>

        {/* the three lanes — stack at 390px */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch">
          <Lane title="arriving" hint={`${frame.pending.length} to go`} color={MUTED}>
            {frame.pending.length === 0 ? (
              <span className="font-mono text-[12px]" style={{ color: MUTED }}>
                —
              </span>
            ) : (
              <AnimatePresence mode="popLayout">
                {frame.pending.map((id) => (
                  <TxnChip key={id} id={id} tone="pending" />
                ))}
              </AnimatePresence>
            )}
          </Lane>

          <Lane
            title="commit batch"
            hint={`${frame.batch.length}/${batchSize} · buffered`}
            color={ACCENT}
            flash={frame.phase === 'arrive'}
          >
            {frame.batch.length === 0 ? (
              <span className="font-mono text-[12px]" style={{ color: MUTED }}>
                empty
              </span>
            ) : (
              <AnimatePresence mode="popLayout">
                {frame.batch.map((id) => (
                  <TxnChip key={id} id={id} tone="batch" />
                ))}
              </AnimatePresence>
            )}
          </Lane>

          <Lane
            title="durable · disk"
            hint={`${frame.durable.length} committed`}
            color={BLUE}
            flash={frame.flushing}
          >
            {frame.durable.length === 0 ? (
              <span className="font-mono text-[12px]" style={{ color: MUTED }}>
                —
              </span>
            ) : (
              <AnimatePresence mode="popLayout">
                {frame.durable.map((id) => (
                  <TxnChip key={id} id={id} tone="durable" />
                ))}
              </AnimatePresence>
            )}
          </Lane>
        </div>

        {/* fsync flash banner */}
        <div style={{ minHeight: 4 }}>
          <AnimatePresence>
            {frame.flushing && (
              <motion.div
                initial={{ opacity: 0, scaleX: 0.4 }}
                animate={{ opacity: 1, scaleX: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
                className="rounded-md px-3 py-1.5 font-sans text-[11.5px] font-semibold text-center"
                style={{ background: `${GREEN}1a`, border: `1px solid ${GREEN}`, color: GREEN }}
              >
                ⤓ fsync — one disk sync, whole batch durable
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* status note */}
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
          <button type="button" onClick={run} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {idx === 0 ? 'Run' : 'Replay'}
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
