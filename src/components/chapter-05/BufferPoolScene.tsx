import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

// The buffer pool, made tangible. A fixed array of frames in RAM and, beside
// it, the page table (page_no -> frame). Requesting a page is a HIT if it is
// already resident (green flash) or a MISS that reads it from disk into a free
// frame (orange disk-read animation + a new page-table row). The §2 affordances
// — a pin badge and a dirty marker per frame — are built in from the start, so
// this same component carries both scenes.

// Disk pages the reader can request. Kept small so a free frame is usually
// available — eviction (a full pool) is Chapter 05 §3, not this scene.
const PAGE_COUNT = 8;

interface Frame {
  pageNo: number;
  pin: number;
  dirty: boolean;
}

type TouchKind = 'hit' | 'miss';
interface Touch {
  frame: number;
  kind: TouchKind;
  nonce: number;
}

function freshFrames(size: number): (Frame | null)[] {
  return Array.from({ length: size }, () => null);
}

export default function BufferPoolScene() {
  const [size, setSize] = useState(4);
  const [frames, setFrames] = useState<(Frame | null)[]>(() => freshFrames(4));
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [touch, setTouch] = useState<Touch | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Resizing the pool starts a clean experiment (matches the other scenes).
  useEffect(() => {
    setFrames(freshFrames(size));
    setHits(0);
    setMisses(0);
    setTouch(null);
    setMessage(null);
  }, [size]);

  // Page table is just a view over the frames: page_no -> frame index.
  const pageTable = useMemo(() => {
    const rows: { pageNo: number; frame: number }[] = [];
    frames.forEach((f, i) => {
      if (f) rows.push({ pageNo: f.pageNo, frame: i });
    });
    rows.sort((a, b) => a.pageNo - b.pageNo);
    return rows;
  }, [frames]);

  const total = hits + misses;
  const hitRate = total ? Math.round((100 * hits) / total) : 0;

  const request = (pageNo: number) => {
    const resident = frames.findIndex((f) => f && f.pageNo === pageNo);
    const id = nonce + 1;
    setNonce(id);
    if (resident >= 0) {
      setHits((h) => h + 1);
      setTouch({ frame: resident, kind: 'hit', nonce: id });
      setMessage(`HIT — page ${pageNo} already resident in frame ${resident}.`);
      return;
    }
    const free = frames.findIndex((f) => f === null);
    if (free < 0) {
      // Spec: no eviction in this scene — that is §3 (EvictionScene).
      setMessage(
        `pool full — every frame is occupied. Evicting to make room is §3.`,
      );
      return;
    }
    setMisses((m) => m + 1);
    setFrames((prev) => {
      const next = [...prev];
      next[free] = { pageNo, pin: 0, dirty: false };
      return next;
    });
    setTouch({ frame: free, kind: 'miss', nonce: id });
    setMessage(`MISS — read page ${pageNo} from disk into frame ${free}.`);
  };

  const mutate = (frame: number, fn: (f: Frame) => Frame) => {
    setFrames((prev) =>
      prev.map((f, i) => (i === frame && f ? fn(f) : f)),
    );
  };

  const pin = (frame: number) => mutate(frame, (f) => ({ ...f, pin: f.pin + 1 }));
  const unpin = (frame: number) =>
    mutate(frame, (f) => ({ ...f, pin: Math.max(0, f.pin - 1) }));
  const modify = (frame: number) => {
    mutate(frame, (f) => ({ ...f, dirty: true }));
    const id = nonce + 1;
    setNonce(id);
    setTouch({ frame, kind: 'hit', nonce: id });
    const pageNo = frames[frame]?.pageNo;
    setMessage(`modified page ${pageNo} in frame ${frame} — it is now dirty.`);
  };

  const reset = () => {
    setFrames(freshFrames(size));
    setHits(0);
    setMisses(0);
    setTouch(null);
    setMessage(null);
  };

  return (
    <Figure
      number="5.1"
      caption="A buffer pool: a fixed array of frames in RAM beside the page table that maps each resident page to its frame. Request a page — a hit (green) returns the resident frame; a miss (orange) reads it from disk into a free frame and adds a table row. Pin a frame to protect it from eviction; modify it to set the dirty bit."
    >
      <div className="space-y-4">
        {/* Hit/miss readout. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)]">
              hit rate
            </div>
            <div className="font-mono text-3xl tabular-nums leading-none">
              {hitRate}
              <span className="text-[color:var(--color-fig-muted)] text-lg">
                %
              </span>
            </div>
          </div>
          <div className="font-sans text-[12px] text-[color:var(--color-fig-muted)] text-right space-y-0.5">
            <div>
              hits:{' '}
              <span className="font-mono text-[color:var(--color-fig-green)]">
                {hits}
              </span>
            </div>
            <div>
              misses:{' '}
              <span className="font-mono text-[color:var(--color-fig-orange)]">
                {misses}
              </span>
            </div>
          </div>
        </div>

        {/* Status line. */}
        <div
          className="font-sans text-[12.5px] font-medium min-h-[1.25rem]"
          style={{
            color:
              message && message.startsWith('HIT')
                ? 'var(--color-fig-green)'
                : message && message.startsWith('MISS')
                  ? 'var(--color-fig-orange)'
                  : message && message.startsWith('pool full')
                    ? 'var(--color-fig-red)'
                    : 'var(--color-fig-muted)',
          }}
        >
          {message ?? 'request a page below — watch for a hit or a miss.'}
        </div>

        {/* Pool + page table: stacks on phones, side-by-side ≥640px. */}
        <div className="flex flex-col [@media(min-width:640px)]:flex-row gap-4">
          {/* The frames. */}
          <div className="flex-1 min-w-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              pool · {size} frames
            </div>
            <div className="grid grid-cols-2 [@media(min-width:520px)]:grid-cols-4 gap-2">
              {frames.map((f, i) => {
                const lit = touch && touch.frame === i;
                const hitLit = lit && touch.kind === 'hit';
                const missLit = lit && touch.kind === 'miss';
                let border = 'rgba(0,0,0,0.10)';
                let bg = 'rgba(0,0,0,0.02)';
                if (hitLit) {
                  border = 'var(--color-fig-green)';
                  bg = 'rgba(47,107,58,0.12)';
                } else if (missLit) {
                  border = 'var(--color-fig-orange)';
                  bg = 'rgba(176,74,20,0.12)';
                } else if (f) {
                  border = 'rgba(30,79,165,0.25)';
                  bg = 'rgba(30,79,165,0.06)';
                }
                return (
                  <motion.div
                    key={i}
                    animate={
                      lit
                        ? { scale: [1, 1.06, 1] }
                        : { scale: 1 }
                    }
                    transition={{ duration: 0.3 }}
                    className="fig-card rounded-md p-2 flex flex-col gap-1.5 min-h-[92px]"
                    style={{ borderColor: border, background: bg }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-[9px] uppercase tracking-[0.1em] text-[color:var(--color-fig-muted)]">
                        frame {i}
                      </span>
                      {f?.dirty && (
                        <span
                          className="font-mono text-[9px] px-1 rounded"
                          title="dirty: modified in RAM, differs from disk"
                          style={{
                            color: 'var(--color-fig-orange)',
                            background: 'rgba(176,74,20,0.12)',
                          }}
                        >
                          ● dirty
                        </span>
                      )}
                    </div>

                    <div className="flex items-baseline gap-1.5">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={f ? f.pageNo : 'empty'}
                          initial={{ opacity: 0, y: missLit ? 8 : 0 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          className="font-mono text-[17px] tabular-nums"
                          style={{
                            color: f
                              ? 'var(--color-fig-blue)'
                              : 'var(--color-fig-muted)',
                          }}
                        >
                          {f ? `P${f.pageNo}` : '·'}
                        </motion.span>
                      </AnimatePresence>
                      {f && f.pin > 0 && (
                        <span
                          className="font-mono text-[10px] px-1 rounded"
                          title={`pinned ${f.pin}× — cannot be evicted`}
                          style={{
                            color: 'var(--color-fig-green)',
                            background: 'rgba(47,107,58,0.12)',
                          }}
                        >
                          📌{f.pin}
                        </span>
                      )}
                    </div>

                    {/* Per-frame actions (only for occupied frames). */}
                    <div className="flex flex-wrap gap-1 mt-auto">
                      <button
                        type="button"
                        disabled={!f}
                        onClick={() => pin(i)}
                        className="font-sans text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
                        style={{
                          borderColor: 'var(--color-fig-muted)',
                          color: 'var(--color-fig-fg)',
                        }}
                        title="pin: protect from eviction"
                      >
                        pin
                      </button>
                      <button
                        type="button"
                        disabled={!f || f.pin === 0}
                        onClick={() => unpin(i)}
                        className="font-sans text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
                        style={{
                          borderColor: 'var(--color-fig-muted)',
                          color: 'var(--color-fig-fg)',
                        }}
                        title="unpin"
                      >
                        unpin
                      </button>
                      <button
                        type="button"
                        disabled={!f}
                        onClick={() => modify(i)}
                        className="font-sans text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30"
                        style={{
                          borderColor: 'var(--color-fig-orange)',
                          color: 'var(--color-fig-orange)',
                        }}
                        title="modify: set the dirty bit"
                      >
                        mod
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* The page table. */}
          <div className="[@media(min-width:640px)]:w-44 shrink-0">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
              page table
            </div>
            <div className="fig-card rounded-md p-2 min-h-[92px]">
              <div className="grid grid-cols-2 gap-x-2 font-mono text-[11px] text-[color:var(--color-fig-muted)] pb-1 mb-1 border-b border-[color:var(--color-fig-muted)]/20">
                <span>page</span>
                <span className="text-right">frame</span>
              </div>
              {pageTable.length === 0 ? (
                <span className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)]/70">
                  empty — no pages resident
                </span>
              ) : (
                <AnimatePresence initial={false}>
                  {pageTable.map((r) => (
                    <motion.div
                      key={r.pageNo}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 gap-x-2 font-mono text-[12px] tabular-nums py-0.5"
                    >
                      <span style={{ color: 'var(--color-fig-blue)' }}>
                        P{r.pageNo}
                      </span>
                      <span className="text-right">→ {r.frame}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>

        {/* Request a page. */}
        <div className="space-y-2 pt-1">
          <div className="font-sans text-[11px] text-[color:var(--color-fig-muted)]">
            request a page:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: PAGE_COUNT }, (_, p) => {
              const resident = frames.some((f) => f && f.pageNo === p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => request(p)}
                  className="fig-btn font-mono"
                  style={
                    resident
                      ? {
                          background: 'rgba(47,107,58,0.10)',
                          borderColor: 'var(--color-fig-green)',
                          color: 'var(--color-fig-green)',
                        }
                      : undefined
                  }
                  title={resident ? `page ${p} (resident → hit)` : `page ${p}`}
                >
                  P{p}
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls. */}
        <div className="space-y-3 pt-1">
          <Slider
            label="pool size (frames)"
            min={2}
            max={8}
            step={1}
            value={size}
            onChange={setSize}
          />
          <button type="button" onClick={reset} className="fig-btn">
            ⏮ Reset
          </button>
          <p className="font-sans text-[11px] text-[color:var(--color-fig-muted)] leading-relaxed">
            Resident pages glow green — request one for a hit. A pinned frame
            (📌) can never be evicted; a modified frame is dirty and must be
            written back before it can be dropped (§7).
          </p>
        </div>
      </div>
    </Figure>
  );
}
