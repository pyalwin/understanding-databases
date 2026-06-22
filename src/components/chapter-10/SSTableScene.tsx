import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * SSTableScene — chapter 10 scene (Figure 10.2, §5).
 *
 * The LSM write-and-read path made visible. Writes land in an in-memory
 * MEMTABLE (backed by an append-only WAL). When the memtable hits its size
 * limit it FLUSHES: its contents are written out, in sorted key order, as one
 * immutable SSTable — and the memtable and WAL clear, because the data now
 * lives in the table. SSTables stack up, NEWEST ON TOP.
 *
 * Then the read path: get(key) checks the memtable first, then walks the stack
 * newest → oldest and stops at the first hit. The schedule updates `a` (a=1 →
 * a=99) across two flushes, so a=1 ends up buried in the older table, SHADOWED
 * by a=99 in the newer one — and the read returns the newest version without
 * ever overwriting the old one in place. Mirrors SSTABLE_SANDBOX exactly.
 *
 * Cream palette only. Reflows at 390px: the memtable chips wrap, the stack
 * scrolls, controls wrap full-width.
 */

/* ------------------------------------------------------------------ */
/*  Frame model                                                       */
/* ------------------------------------------------------------------ */

interface Entry {
  key: string;
  value: number;
}

type ProbeAt = 'mem' | number; // 'mem' = memtable, number = sstable index

interface Probe {
  key: string;
  at: ProbeAt; // where the cursor is THIS frame
  status: 'miss' | 'hit';
  missed: ProbeAt[]; // locations already checked & missed (the trail)
  result: number | null; // resolved value once the read completes
}

interface Frame {
  note: string;
  phase: string;
  memtable: Entry[]; // display order = sorted
  wal: number; // WAL record count
  justPut: string | null; // key just written (highlight)
  flushing: boolean; // the memtable is flushing on this frame
  sstables: Entry[][]; // NEWEST FIRST (index 0 = newest)
  newTable: boolean; // a fresh SSTable appeared this frame
  probe: Probe | null;
}

const LIMIT = 4;

const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

const sortEntries = (m: Record<string, number>): Entry[] =>
  Object.keys(m)
    .sort()
    .map((k) => ({ key: k, value: m[k] }));

function buildFrames(): Frame[] {
  const frames: Frame[] = [];
  const push = (f: Partial<Frame> & { note: string; phase: string }) =>
    frames.push({
      memtable: [],
      wal: 0,
      justPut: null,
      flushing: false,
      sstables: [],
      newTable: false,
      probe: null,
      ...f,
    });

  const T1: Entry[] = [
    { key: 'a', value: 1 },
    { key: 'b', value: 2 },
    { key: 'c', value: 3 },
    { key: 'd', value: 4 },
  ];
  const T2: Entry[] = [
    { key: 'a', value: 99 },
    { key: 'e', value: 5 },
    { key: 'f', value: 6 },
    { key: 'g', value: 7 },
  ];

  // 0 — idle
  push({
    note: 'An empty LSM-tree: a memtable in RAM, an append-only WAL, and an empty SSTable stack. Step through to fill the memtable, flush it, then read a key back.',
    phase: 'idle',
  });

  // 1..4 — fill memtable a,b,c,d
  const fill1 = sortEntries({ a: 1 });
  push({ note: 'put a=1 — appended to the WAL, then written into the memtable.', phase: 'write', memtable: fill1, wal: 1, justPut: 'a' });
  push({ note: 'put b=2 — another WAL append, another memtable entry.', phase: 'write', memtable: sortEntries({ a: 1, b: 2 }), wal: 2, justPut: 'b' });
  push({ note: 'put c=3 — the memtable is filling. Still all in memory.', phase: 'write', memtable: sortEntries({ a: 1, b: 2, c: 3 }), wal: 3, justPut: 'c' });
  push({
    note: 'put d=4 — the memtable now holds 4 keys and hits its limit. Time to flush.',
    phase: 'limit',
    memtable: sortEntries({ a: 1, b: 2, c: 3, d: 4 }),
    wal: 4,
    justPut: 'd',
  });

  // 5 — flush #1
  push({
    note: 'FLUSH: the memtable is written out in sorted order as one immutable SSTable. The memtable empties and the WAL truncates — the data is safe on disk now.',
    phase: 'flush',
    flushing: true,
    sstables: [T1],
    newTable: true,
  });

  // 6..9 — update a, fill e,f,g
  push({
    note: 'put a=99 — an UPDATE. It just appends a new value; the old a=1 still sits untouched inside SSTable #0.',
    phase: 'write',
    memtable: sortEntries({ a: 99 }),
    wal: 1,
    justPut: 'a',
    sstables: [T1],
  });
  push({ note: 'put e=5 — refilling the memtable.', phase: 'write', memtable: sortEntries({ a: 99, e: 5 }), wal: 2, justPut: 'e', sstables: [T1] });
  push({ note: 'put f=6 — three keys in the memtable.', phase: 'write', memtable: sortEntries({ a: 99, e: 5, f: 6 }), wal: 3, justPut: 'f', sstables: [T1] });
  push({
    note: 'put g=7 — the memtable is full again.',
    phase: 'limit',
    memtable: sortEntries({ a: 99, e: 5, f: 6, g: 7 }),
    wal: 4,
    justPut: 'g',
    sstables: [T1],
  });

  // 10 — flush #2 (new table goes ON TOP)
  push({
    note: 'FLUSH again. The new SSTable goes on TOP of the stack (newest first). Now a=99 lives in #0 and a=1 lives in #1 — two versions of a, in two tables.',
    phase: 'flush',
    flushing: true,
    sstables: [T2, T1],
    newTable: true,
  });

  // 11..12 — get(a): memtable miss, then hit in newest table
  push({
    note: 'get(a): check the memtable first. It is empty (just flushed) — a miss. Walk down to the SSTable stack.',
    phase: 'read',
    sstables: [T2, T1],
    probe: { key: 'a', at: 'mem', status: 'miss', missed: [], result: null },
  });
  push({
    note: 'Check SSTable #0 (newest): HIT — a=99. Stop here. The a=1 down in #1 is SHADOWED by the newer table and never consulted. get(a) = 99.',
    phase: 'read',
    sstables: [T2, T1],
    probe: { key: 'a', at: 0, status: 'hit', missed: ['mem'], result: 99 },
  });

  // 13..15 — get(c): memtable miss, newest miss, oldest hit
  push({
    note: 'get(c): the memtable is empty — miss.',
    phase: 'read',
    sstables: [T2, T1],
    probe: { key: 'c', at: 'mem', status: 'miss', missed: [], result: null },
  });
  push({
    note: 'Check SSTable #0 (newest): c is not in this table — miss. Keep walking down.',
    phase: 'read',
    sstables: [T2, T1],
    probe: { key: 'c', at: 0, status: 'miss', missed: ['mem'], result: null },
  });
  push({
    note: 'Check SSTable #1 (oldest): HIT — c=3. A key that was never updated is found only in the older table, so the read had to scan deeper. get(c) = 3.',
    phase: 'read',
    sstables: [T2, T1],
    probe: { key: 'c', at: 1, status: 'hit', missed: ['mem', 0], result: 3 },
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Shadowing — an entry is shadowed if a NEWER table (or the          */
/*  memtable) holds the same key.                                      */
/* ------------------------------------------------------------------ */

function isShadowed(frame: Frame, tableIdx: number, key: string): boolean {
  if (frame.memtable.some((e) => e.key === key)) return true;
  for (let i = 0; i < tableIdx; i++) {
    if (frame.sstables[i].some((e) => e.key === key)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Entry chip                                                        */
/* ------------------------------------------------------------------ */

function Chip({
  e,
  highlight,
  shadowed,
  hit,
}: {
  e: Entry;
  highlight?: boolean;
  shadowed?: boolean;
  hit?: boolean;
}) {
  const border = hit ? GREEN : highlight ? ACCENT : shadowed ? 'rgba(0,0,0,0.16)' : `${BLUE}55`;
  const bg = hit ? `${GREEN}1f` : highlight ? `${ACCENT}1f` : 'var(--color-fig-bg)';
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: shadowed && !hit ? 0.5 : 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="inline-flex items-center font-mono text-[13px]"
      style={{
        padding: '2px 8px',
        borderRadius: 6,
        border: `1.5px solid ${border}`,
        background: bg,
        color: 'var(--color-fig-fg)',
        fontWeight: 700,
        textDecoration: shadowed && !hit ? 'line-through' : 'none',
        textDecorationColor: MUTED,
      }}
    >
      {e.key}={e.value}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function SSTableScene() {
  const frames = useMemo(() => buildFrames(), []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 1100 - speed * 150; // speed 1→950ms … 5→350ms
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

  const probe = frame.probe;
  const memProbed = probe?.at === 'mem';

  return (
    <Figure
      number="10.2"
      caption="The LSM write and read path. Writes fill an in-memory memtable (and an append-only WAL); when it fills, a FLUSH writes it out as one immutable, sorted SSTable and clears the memtable — new tables stack newest-on-top. A read checks the memtable, then walks the stack newest → oldest and stops at the first hit. Updating a (a=1 → a=99) across two flushes leaves a=1 buried in the older table, SHADOWED by a=99 above it: the read returns the newest version without ever overwriting the old one in place. On a narrow screen the memtable wraps and the stack scrolls."
    >
      <div className="space-y-4">
        {/* phase pill */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${frame.phase === 'flush' ? `${ACCENT}` : 'rgba(0,0,0,0.14)'}`,
              color: frame.phase === 'flush' ? ACCENT : frame.phase === 'read' ? BLUE : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background:
                  frame.phase === 'flush' ? ACCENT : frame.phase === 'read' ? BLUE : frame.phase === 'limit' ? RED : GREEN,
                display: 'inline-block',
              }}
            />
            {frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
          {probe && (
            <span className="font-mono tabular-nums text-[11px]" style={{ color: BLUE }}>
              get({probe.key}){probe.result !== null ? ` = ${probe.result}` : ' …'}
            </span>
          )}
        </div>

        {/* MEMTABLE (RAM) + WAL */}
        <motion.div
          layout
          className="fig-card"
          style={{
            padding: '12px',
            borderColor: memProbed ? `${ACCENT}` : frame.flushing ? `${ACCENT}88` : `${GREEN}55`,
            background: memProbed ? `${ACCENT}10` : 'var(--color-fig-bg)',
          }}
        >
          <div className="mb-2 flex items-center justify-between font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            <span>memtable · RAM</span>
            <span className="font-mono normal-case tracking-normal" style={{ color: frame.wal > 0 ? ACCENT : MUTED }}>
              WAL: {frame.wal} {frame.wal === 1 ? 'record' : 'records'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" style={{ minHeight: 30 }}>
            {frame.memtable.length === 0 ? (
              <span className="font-mono text-[12.5px] italic" style={{ color: MUTED }}>
                {memProbed ? '(empty — miss, walk to the stack ↓)' : '(empty)'}
              </span>
            ) : (
              <AnimatePresence>
                {frame.memtable.map((e) => (
                  <Chip key={e.key} e={e} highlight={e.key === frame.justPut} />
                ))}
              </AnimatePresence>
            )}
            <span className="ml-auto font-mono text-[11px]" style={{ color: MUTED }}>
              limit {frame.memtable.length}/{LIMIT}
            </span>
          </div>
        </motion.div>

        {/* flush arrow */}
        <div className="flex items-center justify-center" style={{ height: 18 }}>
          <motion.span
            animate={{ opacity: frame.flushing ? 1 : 0.3, y: frame.flushing ? [0, 4, 0] : 0 }}
            transition={{ duration: 0.6, repeat: frame.flushing ? Infinity : 0 }}
            className="font-sans text-[11px] font-semibold"
            style={{ color: frame.flushing ? ACCENT : MUTED }}
          >
            {frame.flushing ? '⤓ flush (sorted, immutable)' : '↓'}
          </motion.span>
        </div>

        {/* SSTABLE STACK (newest on top), scrolls at 390px */}
        <div
          className="fig-card"
          style={{ padding: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            SSTable stack · disk (newest first)
          </div>
          {frame.sstables.length === 0 ? (
            <div className="font-mono text-[12.5px] italic" style={{ color: MUTED }}>
              (no SSTables yet)
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {frame.sstables.map((sst, i) => {
                  const probing = probe?.at === i;
                  const isHit = probing && probe?.status === 'hit';
                  const isMiss = (probing && probe?.status === 'miss') || probe?.missed.includes(i);
                  const ring = isHit ? GREEN : probing ? ACCENT : isMiss ? 'rgba(0,0,0,0.14)' : `${BLUE}44`;
                  const isNewest = i === 0;
                  return (
                    <motion.div
                      key={`${sst[0].key}-${sst[0].value}-${i}`}
                      layout
                      initial={frame.newTable && i === 0 ? { opacity: 0, y: -14 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                      className="rounded-md"
                      style={{
                        border: `1.5px solid ${ring}`,
                        background: isHit ? `${GREEN}10` : probing ? `${ACCENT}0d` : 'var(--color-fig-bg)',
                        padding: '8px 10px',
                      }}
                    >
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold" style={{ color: isHit ? GREEN : probing ? ACCENT : BLUE }}>
                          SSTable #{i}
                          <span className="ml-1 font-sans font-normal" style={{ color: MUTED }}>
                            {isNewest ? 'newest' : i === frame.sstables.length - 1 ? 'oldest' : ''}
                          </span>
                        </span>
                        {probing && (
                          <span
                            className="font-sans text-[10px] font-bold uppercase tracking-wide"
                            style={{ color: isHit ? GREEN : RED }}
                          >
                            {isHit ? 'hit ✓' : 'miss'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {sst.map((e) => {
                          const shadowed = isShadowed(frame, i, e.key);
                          const hitChip = isHit && e.key === probe?.key;
                          return <Chip key={e.key} e={e} shadowed={shadowed} hit={hitChip} />;
                        })}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* legend (only once both tables hold a version of a) */}
        {frame.sstables.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 font-sans text-[11px]" style={{ color: MUTED }}>
            <span className="inline-flex items-center gap-1.5">
              <span style={{ width: 18, height: 0, borderTop: `1.5px solid ${GREEN}` }} /> hit (newest wins)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono" style={{ textDecoration: 'line-through', textDecorationColor: MUTED, opacity: 0.6 }}>
                a=1
              </span>{' '}
              shadowed (older, never read)
            </span>
          </div>
        )}

        {/* status line */}
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

        {/* controls */}
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
