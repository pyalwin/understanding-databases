import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Toggle } from '@/components/scene';

/*
 * VacuumScene — chapter 09 scene (Figure 9.4).
 *
 * The bill for never overwriting. Every UPDATE appends a new version of a row
 * and stamps the old one's xmax with the deleting xid — so dead versions pile
 * up in the heap page. VACUUM is how the bill gets paid: reclaim the tuples no
 * live snapshot can ever read again.
 *
 * The page is a slot grid (the ch04 slotted page: each version lives in a slot;
 * slot numbers are sacred, vacuum reclaims the *bytes*, freeing the slot for
 * reuse). We step a fixed schedule that fills the page with versions of row
 * `a`, then the key MVCC lesson: a long-running reader, opened CONCURRENTLY
 * with the writer, freezes its view at a=2. Its snapshot pins the horizon
 * (oldest_xmin), so the versions the writer deleted CANNOT be reclaimed while
 * it stays open — even though they are dead. Close the reader and the horizon
 * jumps forward; now vacuum can sweep them.
 *
 * Cream palette only. Reflows at 390px: the slot grid wraps, controls stack.
 */

/* ------------------------------------------------------------------ */
/*  Model — mirrors the canonical MVCCStore (xmin/xmax) from §2–§6     */
/* ------------------------------------------------------------------ */

interface Tuple {
  slot: number; // stable address (ch04: slot numbers never renumber)
  key: string;
  value: number;
  xmin: number; // creator xid
  xmax: number | null; // deleter xid (null = still live)
}

interface Frame {
  note: string;
  phase: string;
  writerCommitted: boolean; // xid 3 (the writer) has committed
  readerArrived: boolean; // the long reader has opened its snapshot
  tuples: Tuple[];
}

// Fixed xids for this schedule:
//   1 = setup insert,  2 = pre-reader update,  3 = concurrent writer,
//   4 = long reader (read-only). Reader's snapshot is {3}, so its horizon
//   (oldest_xmin) = min({3} ∪ {4}) = 3.
const R_XMIN = 3; // horizon while the long reader is open
const NEXT_XID = 5; // horizon once everyone has finished (no live snapshot)

function buildFrames(): Frame[] {
  const frames: Frame[] = [];

  frames.push({
    note: 'An empty heap page — a grid of slots, just like chapter 4. Step through to watch versions of row a accumulate, then vacuum the dead ones.',
    phase: 'idle',
    writerCommitted: false,
    readerArrived: false,
    tuples: [],
  });

  // 1 — setup inserts a=1, b=1 (xid 1, committed)
  frames.push({
    note: 'A committed transaction (xid 1) inserts two rows: a=1 in slot 0, b=1 in slot 1. Both live.',
    phase: 'insert',
    writerCommitted: false,
    readerArrived: false,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: null },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
    ],
  });

  // 2 — pre-reader update a→2 (xid 2, commits BEFORE the reader)
  frames.push({
    note: 'Update a→2 (xid 2) commits before the reader arrives: it stamps a=1’s xmax=2 (now dead) and appends a=2 in slot 2.',
    phase: 'update',
    writerCommitted: false,
    readerArrived: false,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: 2 },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
      { slot: 2, key: 'a', value: 2, xmin: 2, xmax: null },
    ],
  });

  // 3 — writer (xid 3) + long reader (xid 4) begin concurrently
  frames.push({
    note: 'A writer (xid 3) and a long-running reader (xid 4) open at the same instant. The reader records the writer as in-progress in its snapshot {3} — freezing its view at a=2.',
    phase: 'begin',
    writerCommitted: false,
    readerArrived: true,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: 2 },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
      { slot: 2, key: 'a', value: 2, xmin: 2, xmax: null },
    ],
  });

  // 4 — writer updates a→3
  frames.push({
    note: 'The writer updates a→3: a=2’s xmax becomes 3, and a=3 lands in slot 3. The reader can’t see this — xid 3 is in its snapshot.',
    phase: 'update',
    writerCommitted: false,
    readerArrived: true,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: 2 },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
      { slot: 2, key: 'a', value: 2, xmin: 2, xmax: 3 },
      { slot: 3, key: 'a', value: 3, xmin: 3, xmax: 3 },
    ],
  });

  // 5 — writer updates a→4
  frames.push({
    note: 'The writer updates a→4 in the same transaction: a=3 is stamped dead and a=4 lands in slot 4. The page now holds four versions of a.',
    phase: 'update',
    writerCommitted: false,
    readerArrived: true,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: 2 },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
      { slot: 2, key: 'a', value: 2, xmin: 2, xmax: 3 },
      { slot: 3, key: 'a', value: 3, xmin: 3, xmax: 3 },
      { slot: 4, key: 'a', value: 4, xmin: 3, xmax: null },
    ],
  });

  // 6 — writer commits; dead versions are now classified
  frames.push({
    note: 'The writer commits. Three versions of a are now dead (deleter committed). But the long reader still reads a=2 — its snapshot pins the horizon at xid 3, so anything deleted by xid 3 is PINNED. Run vacuum.',
    phase: 'ready',
    writerCommitted: true,
    readerArrived: true,
    tuples: [
      { slot: 0, key: 'a', value: 1, xmin: 1, xmax: 2 },
      { slot: 1, key: 'b', value: 1, xmin: 1, xmax: null },
      { slot: 2, key: 'a', value: 2, xmin: 2, xmax: 3 },
      { slot: 3, key: 'a', value: 3, xmin: 3, xmax: 3 },
      { slot: 4, key: 'a', value: 4, xmin: 3, xmax: null },
    ],
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Status classification                                             */
/* ------------------------------------------------------------------ */

const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

type SlotStatus = 'live' | 'reclaimable' | 'pinned' | 'pending' | 'free';

// A version is DEAD when its deleter committed. xid 2 commits early; xid 3 (the
// writer) commits at the final frame. The reader (xid 4) holds the horizon at
// R_XMIN while it is open.
function classify(
  t: Tuple,
  frame: Frame,
  readerOpen: boolean,
  freed: Set<number>,
): SlotStatus {
  if (freed.has(t.slot)) return 'free';
  if (t.xmax === null) return 'live';
  // committed?  xid 2 always; xid 3 only once the writer has committed.
  const deleterCommitted = t.xmax === 2 || (t.xmax === 3 && frame.writerCommitted);
  if (!deleterCommitted) return 'pending'; // deleted, but deleter not yet committed
  const horizon = readerOpen && frame.readerArrived ? R_XMIN : NEXT_XID;
  return t.xmax < horizon ? 'reclaimable' : 'pinned';
}

const STATUS_META: Record<SlotStatus, { label: string; color: string }> = {
  live: { label: 'live', color: GREEN },
  reclaimable: { label: 'dead · reclaimable', color: RED },
  pinned: { label: 'dead · pinned', color: ACCENT },
  pending: { label: 'deleted', color: MUTED },
  free: { label: 'free', color: MUTED },
};

/* ------------------------------------------------------------------ */
/*  Slot cell                                                         */
/* ------------------------------------------------------------------ */

function SlotCell({ t, status }: { t: Tuple; status: SlotStatus }) {
  const meta = STATUS_META[status];
  const isFree = status === 'free';

  return (
    <motion.div
      layout
      className="fig-card"
      style={{
        width: 132,
        padding: '8px 10px',
        borderColor: isFree ? 'rgba(0,0,0,0.18)' : `${meta.color}88`,
        borderStyle: isFree ? 'dashed' : 'solid',
        background: isFree ? 'transparent' : 'var(--color-fig-bg)',
        opacity: isFree ? 0.65 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="font-sans text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: MUTED }}
        >
          slot {t.slot}
        </span>
      </div>

      {isFree ? (
        <div
          className="mt-2 font-mono text-[13px]"
          style={{ color: MUTED, fontStyle: 'italic' }}
        >
          reclaimed
        </div>
      ) : (
        <>
          <div
            className="mt-1.5 font-mono text-[15px] font-bold"
            style={{
              color: 'var(--color-fig-fg)',
              textDecoration:
                status === 'reclaimable' || status === 'pinned' ? 'line-through' : 'none',
              textDecorationColor: meta.color,
            }}
          >
            {t.key}={t.value}
          </div>
          <div className="mt-1.5 flex items-center gap-1 font-mono text-[10.5px]" style={{ color: MUTED }}>
            <span
              style={{
                padding: '0px 4px',
                borderRadius: 4,
                border: `1px solid ${BLUE}66`,
                color: BLUE,
              }}
            >
              xmin {t.xmin}
            </span>
            <span
              style={{
                padding: '0px 4px',
                borderRadius: 4,
                border: `1px solid ${t.xmax === null ? 'rgba(0,0,0,0.16)' : `${RED}66`}`,
                color: t.xmax === null ? MUTED : RED,
              }}
            >
              xmax {t.xmax === null ? '—' : t.xmax}
            </span>
          </div>
        </>
      )}

      {/* status badge — its own row so it never collides with the slot id at 390px */}
      <div
        className="mt-2 inline-flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-semibold font-sans"
        style={{
          background: isFree ? 'transparent' : `${meta.color}1a`,
          border: `1px solid ${meta.color}${isFree ? '55' : ''}`,
          color: meta.color,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: meta.color,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        {meta.label}
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function VacuumScene() {
  const frames = useMemo(() => buildFrames(), []);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [readerOpen, setReaderOpen] = useState(true);
  const [freed, setFreed] = useState<Set<number>>(new Set());

  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;
  const canVacuum = frame.phase === 'ready';

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Auto-advance while filling the page.
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
    }, 900);
    return () => clearTimeout(t);
  }, [playing, idx, frames.length]);

  const horizon = readerOpen && frame.readerArrived ? R_XMIN : NEXT_XID;

  // Live status for each tuple at this frame.
  const statuses = frame.tuples.map((t) => classify(t, frame, readerOpen, freed));
  const reclaimableNow = frame.tuples.filter(
    (_t, i) => statuses[i] === 'reclaimable',
  );
  const pinnedNow = frame.tuples.filter((_t, i) => statuses[i] === 'pinned').length;
  const liveNow = frame.tuples.filter((_t, i) => statuses[i] === 'live').length;
  const freedCount = frame.tuples.filter((_t, i) => statuses[i] === 'free').length;
  const readerValue = 2; // the reader's frozen view of `a`

  const run = () => {
    setIdx(0);
    setFreed(new Set());
    setPlaying(true);
  };
  const step = () => {
    setPlaying(false);
    setIdx((i) => Math.min(i + 1, frames.length - 1));
  };
  const reset = () => {
    setPlaying(false);
    setIdx(0);
    setFreed(new Set());
  };
  const vacuum = () => {
    setPlaying(false);
    setFreed((prev) => {
      const next = new Set(prev);
      reclaimableNow.forEach((t) => next.add(t.slot));
      return next;
    });
  };
  const toggleReader = (v: boolean) => {
    setReaderOpen(v);
  };

  return (
    <Figure
      number="9.4"
      caption="A heap page (the ch04 slotted page) filling with row versions. Every UPDATE appends a new version and stamps the old one’s xmax — dead versions pile up. Vacuum reclaims the tuples no live snapshot can read: those whose deleter committed below the horizon (oldest_xmin). A long-running reader, opened concurrently with the writer, freezes its view at a=2 and pins the horizon at xid 3 — so the versions the writer deleted stay PINNED until the reader closes. Toggle the reader to watch them become reclaimable. On a narrow screen the slot grid wraps and the controls stack."
    >
      <div className="space-y-4">
        {/* phase + counters */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: 'var(--color-fig-bg)',
              border: '1px solid rgba(0,0,0,0.14)',
              color: MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: canVacuum ? GREEN : ACCENT,
                display: 'inline-block',
              }}
            />
            {frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: BLUE }}>
            horizon (oldest_xmin) = {horizon}
          </span>
        </div>

        {/* heap page — slot grid, wraps at 390px */}
        <div className="fig-card" style={{ padding: '12px' }}>
          <div
            className="mb-2 flex items-center justify-between font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: MUTED }}
          >
            <span>heap page · version list</span>
            <span className="font-mono normal-case tracking-normal">
              {liveNow} live · {pinnedNow} pinned · {freedCount} free
            </span>
          </div>
          {frame.tuples.length === 0 ? (
            <div
              className="font-sans text-[12.5px] italic"
              style={{ color: MUTED, padding: '12px 4px' }}
            >
              (empty — no rows yet)
            </div>
          ) : (
            <motion.div layout className="flex flex-wrap gap-2">
              <AnimatePresence>
                {frame.tuples.map((t, i) => (
                  <motion.div
                    key={t.slot}
                    layout
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <SlotCell t={t} status={statuses[i]} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* long-running reader pill */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 font-sans"
          style={{
            background: frame.readerArrived && readerOpen ? `${ACCENT}12` : 'rgba(0,0,0,0.03)',
            border: `1px solid ${frame.readerArrived && readerOpen ? `${ACCENT}55` : 'rgba(0,0,0,0.08)'}`,
          }}
        >
          <span className="text-[12px]" style={{ color: 'var(--color-fig-fg)' }}>
            {frame.readerArrived ? (
              readerOpen ? (
                <>
                  long reader (xid 4){' '}
                  <span style={{ color: ACCENT, fontWeight: 600 }}>open</span> — frozen at{' '}
                  <span className="font-mono">a={readerValue}</span>, pinning the horizon
                </>
              ) : (
                <>
                  long reader{' '}
                  <span style={{ color: GREEN, fontWeight: 600 }}>committed</span> — horizon released
                </>
              )
            ) : (
              <span style={{ color: MUTED }}>no long-running reader yet</span>
            )}
          </span>
          <Toggle label="reader open" value={readerOpen} onChange={toggleReader} />
        </div>

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
            {idx === 0 ? 'Fill the page' : 'Replay'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button
            type="button"
            onClick={vacuum}
            disabled={!canVacuum || reclaimableNow.length === 0}
            className="fig-btn"
            style={{
              minHeight: 38,
              borderColor: canVacuum && reclaimableNow.length > 0 ? RED : undefined,
              color: canVacuum && reclaimableNow.length > 0 ? RED : undefined,
            }}
          >
            Vacuum{canVacuum && reclaimableNow.length > 0 ? ` (${reclaimableNow.length})` : ''}
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
        </div>
      </div>
    </Figure>
  );
}
