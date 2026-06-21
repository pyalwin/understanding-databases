import React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * EvictionScene — chapter 05 HERO scene (§3, LRU eviction).
 *
 * A fixed pool of N frames with an EXPLICIT recency lane: most-recently-used
 * at the front, least-recently-used at the back. The reader requests pages by
 * number:
 *   - HIT  → the page is resident; it flashes green and jumps to MRU.
 *   - MISS → not resident. If a free frame exists, read the page into it.
 *            If the pool is full, the LRU (back) frame is the victim: it is
 *            highlighted, written back to disk first IF it is dirty, evicted,
 *            and the new page is installed at MRU.
 *
 * Clicking a resident frame toggles its dirty bit, so the reader can set up a
 * dirty victim and watch the extra write-back step on eviction.
 *
 * The "hot root" demo replays a trace where one page (the B-tree root from
 * ch04) is touched on every other request: it is re-promoted to MRU constantly
 * and therefore never becomes the LRU victim — it never gets evicted. That is
 * the explicit ch04 callback: the hot top of the tree stays resident under LRU.
 *
 * Mobile (390px): the recency lane is vertical (frames stack, MRU on top);
 * desktop it is horizontal (MRU on the left). Reflow driven by measured width.
 */

const ROOT_ID = 0; // the "B-tree root" page — special-cased only for its label

interface ResidentFrame {
  id: number;
  label: string;
  dirty: boolean;
}

const COLORS = {
  resident: 'var(--color-fig-blue)',
  hit: 'var(--color-fig-green)',
  victim: 'var(--color-fig-red)',
  install: 'var(--color-accent)',
  dirty: 'var(--color-fig-orange)',
  root: 'var(--color-fig-green)',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function labelFor(id: number): string {
  return id === ROOT_ID ? 'root' : `P${id}`;
}

/* ------------------------------------------------------------------ */
/*  Frame card                                                         */
/* ------------------------------------------------------------------ */

type Flash = 'hit' | 'install' | 'victim' | 'writeback' | null;

interface FrameCardProps {
  frame: ResidentFrame;
  rank: number; // 0 = MRU
  isMru: boolean;
  isLru: boolean;
  flash: Flash;
  onToggleDirty: () => void;
  disabled: boolean;
}

function FrameCard({ frame, rank, isMru, isLru, flash, onToggleDirty, disabled }: FrameCardProps) {
  const isRoot = frame.id === ROOT_ID;
  let ring = isRoot ? COLORS.root : COLORS.resident;
  if (flash === 'hit') ring = COLORS.hit;
  else if (flash === 'install') ring = COLORS.install;
  else if (flash === 'victim' || flash === 'writeback') ring = COLORS.victim;

  const ringSoft =
    flash === 'hit'
      ? 'rgba(47,107,58,0.18)'
      : flash === 'install'
        ? 'rgba(180,83,9,0.18)'
        : flash === 'victim' || flash === 'writeback'
          ? 'rgba(169,30,30,0.18)'
          : 'transparent';

  return (
    <motion.button
      type="button"
      layout
      onClick={onToggleDirty}
      disabled={disabled}
      title="Click to toggle this frame's dirty bit — a modified page must be written back before it can be evicted."
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="text-left w-full sm:w-24"
      style={{
        position: 'relative',
        flex: '0 0 auto',
        minHeight: 66,
        borderRadius: 10,
        background: 'var(--color-fig-bg)',
        border: `2px solid ${ring}`,
        boxShadow: `0 0 0 3px ${ringSoft}`,
        padding: '8px 9px',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="font-mono font-semibold"
          style={{ fontSize: 15, color: isRoot ? COLORS.root : 'var(--color-fig-fg)' }}
        >
          {frame.label}
        </span>
        {frame.dirty && (
          <span
            className="font-sans font-semibold"
            style={{
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: COLORS.dirty,
              border: `1px solid ${COLORS.dirty}`,
              borderRadius: 4,
              padding: '0 3px',
            }}
          >
            dirty
          </span>
        )}
      </div>
      <div className="font-sans" style={{ fontSize: 9.5, color: 'var(--color-fig-muted)' }}>
        {isMru ? 'most recent' : isLru ? 'least recent' : `rank ${rank + 1}`}
      </div>
      {flash === 'writeback' && (
        <div
          className="font-sans font-semibold"
          style={{ fontSize: 9, color: COLORS.victim }}
        >
          writing back…
        </div>
      )}
      {flash === 'victim' && (
        <div
          className="font-sans font-semibold"
          style={{ fontSize: 9, color: COLORS.victim }}
        >
          ← LRU victim
        </div>
      )}
    </motion.button>
  );
}

function EmptySlot() {
  return (
    <div
      aria-hidden
      style={{
        flex: '0 0 auto',
        minHeight: 66,
        borderRadius: 10,
        border: '2px dashed rgba(0,0,0,0.16)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-fig-muted)',
        fontSize: 11,
      }}
      className="font-sans w-full sm:w-24"
    >
      empty frame
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const STEP_MS = 620;

export default function EvictionScene() {
  const [poolSize, setPoolSize] = useState(4);
  const [frames, setFrames] = useState<ResidentFrame[]>([]);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [evictions, setEvictions] = useState(0);
  const [writebacks, setWritebacks] = useState(0);
  const [status, setStatus] = useState('Request a page to read it into the pool.');
  const [flash, setFlash] = useState<{ id: number; kind: Flash } | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const framesRef = useRef<ResidentFrame[]>([]);
  const poolRef = useRef(poolSize);
  const busyRef = useRef(false);

  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);
  useEffect(() => {
    poolRef.current = poolSize;
  }, [poolSize]);

  const setBusyBoth = (v: boolean) => {
    busyRef.current = v;
    setBusy(v);
  };

  const commit = (next: ResidentFrame[]) => {
    framesRef.current = next;
    setFrames(next);
  };

  /* one page request — no busy guard (callers manage busy) */
  const doRequest = useCallback(async (id: number, write: boolean) => {
    const label = labelFor(id);
    const cur = framesRef.current;
    const idx = cur.findIndex((f) => f.id === id);

    if (idx >= 0) {
      // HIT — promote to MRU, mark dirty if this was a write.
      setHits((h) => h + 1);
      const moved = { ...cur[idx], dirty: cur[idx].dirty || write };
      const next = [moved, ...cur.slice(0, idx), ...cur.slice(idx + 1)];
      commit(next);
      setFlash({ id, kind: 'hit' });
      setStatus(`HIT — ${label} is resident; promoted to most-recently-used.`);
      await sleep(STEP_MS);
      setFlash(null);
      return;
    }

    // MISS.
    setMisses((m) => m + 1);
    if (cur.length >= poolRef.current) {
      const victim = cur[cur.length - 1];
      setFlash({ id: victim.id, kind: 'victim' });
      setStatus(`MISS — pool full. ${victim.label} is least-recently-used → the victim.`);
      await sleep(STEP_MS);
      if (victim.dirty) {
        setFlash({ id: victim.id, kind: 'writeback' });
        setStatus(`${victim.label} is dirty — writing it back to disk before evicting.`);
        setWritebacks((w) => w + 1);
        await sleep(STEP_MS);
      }
      const evicted = cur.slice(0, cur.length - 1);
      commit(evicted);
      setEvictions((e) => e + 1);
      setStatus(`Evicted ${victim.label}. Reading ${label} from disk…`);
      await sleep(STEP_MS / 2);
      const installed = [{ id, label, dirty: write }, ...framesRef.current];
      commit(installed);
      setFlash({ id, kind: 'install' });
      setStatus(`MISS — read ${label} from disk, installed at most-recently-used.`);
      await sleep(STEP_MS);
      setFlash(null);
      return;
    }

    // MISS into a free frame.
    const installed = [{ id, label, dirty: write }, ...cur];
    commit(installed);
    setFlash({ id, kind: 'install' });
    setStatus(`MISS — read ${label} into a free frame (no eviction needed yet).`);
    await sleep(STEP_MS);
    setFlash(null);
  }, []);

  const requestManual = async () => {
    if (busyRef.current) return;
    const n = parseInt(inputValue, 10);
    if (Number.isNaN(n) || n < 1 || n > 99) {
      setStatus('Enter a page number between 1 and 99 (page 0 is the root — use the demo).');
      return;
    }
    setBusyBoth(true);
    await doRequest(n, false);
    setInputValue('');
    setBusyBoth(false);
  };

  const runTrace = async (trace: number[], writes: Set<number>, intro: string) => {
    if (busyRef.current) return;
    setBusyBoth(true);
    setStatus(intro);
    await sleep(STEP_MS / 2);
    for (const id of trace) {
      // eslint-disable-next-line no-await-in-loop
      await doRequest(id, writes.has(id));
    }
    setBusyBoth(false);
  };

  const hotRootDemo = () => {
    // root touched on every other request; the rest cycle through and age out.
    const others = [1, 2, 3, 4, 5, 6, 7];
    const trace: number[] = [];
    for (const o of others) {
      trace.push(ROOT_ID, o);
    }
    trace.push(ROOT_ID);
    // root is a written page (an index update), so it's dirty — yet still never evicted.
    runTrace(
      trace,
      new Set([ROOT_ID]),
      'Replaying a B-tree workload: the root is touched on every other request…',
    );
  };

  const fillEvictDemo = () => {
    const trace = [1, 2, 3, 4, 5, 6, 7, 8];
    runTrace(
      trace,
      new Set([2, 5]),
      'Sequential fill: once the pool is full, each new page evicts the LRU one.',
    );
  };

  const toggleDirty = (id: number) => {
    if (busyRef.current) return;
    const cur = framesRef.current;
    const next = cur.map((f) => (f.id === id ? { ...f, dirty: !f.dirty } : f));
    commit(next);
    const f = next.find((x) => x.id === id);
    setStatus(
      f?.dirty
        ? `${labelFor(id)} marked dirty — evicting it now costs a disk write first.`
        : `${labelFor(id)} marked clean — it can be dropped without a write.`,
    );
  };

  const reset = () => {
    if (busyRef.current) return;
    commit([]);
    setHits(0);
    setMisses(0);
    setEvictions(0);
    setWritebacks(0);
    setFlash(null);
    setStatus('Cleared. Request a page to read it into the pool.');
  };

  const handlePool = (v: number) => {
    if (busyRef.current) return;
    const size = Math.max(3, Math.min(6, v));
    setPoolSize(size);
    poolRef.current = size;
    // Shrinking? drop the LRU overflow.
    if (framesRef.current.length > size) {
      commit(framesRef.current.slice(0, size));
    }
    setStatus(`Pool resized to ${size} frames.`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      requestManual();
    }
  };

  const total = hits + misses;
  const hitRate = total === 0 ? 0 : Math.round((100 * hits) / total);
  const flashFor = (id: number): Flash => (flash?.id === id ? flash.kind : null);
  const emptyCount = Math.max(0, poolSize - frames.length);
  const rootResident = frames.some((f) => f.id === ROOT_ID);

  return (
    <Figure
      number="5.2"
      caption="An LRU buffer pool. Request pages by number: a hit (green) jumps the page to most-recently-used; a miss into a full pool evicts the least-recently-used frame at the back — writing it back first if it is dirty (orange). Run the B-tree workload and watch the root, touched every other request, sit at the front and never get evicted. Click any frame to toggle its dirty bit."
    >
      <div className="space-y-4">
        {/* counters */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-[11px]">
          <span style={{ color: 'var(--color-fig-muted)' }}>
            hits{' '}
            <span className="font-semibold tabular-nums" style={{ color: COLORS.hit }}>
              {hits}
            </span>
          </span>
          <span style={{ color: 'var(--color-fig-muted)' }}>
            misses{' '}
            <span className="font-semibold tabular-nums" style={{ color: COLORS.victim }}>
              {misses}
            </span>
          </span>
          <span style={{ color: 'var(--color-fig-muted)' }}>
            evictions{' '}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-fig-fg)' }}>
              {evictions}
            </span>
          </span>
          <span style={{ color: 'var(--color-fig-muted)' }}>
            write-backs{' '}
            <span className="font-semibold tabular-nums" style={{ color: COLORS.dirty }}>
              {writebacks}
            </span>
          </span>
          <span style={{ color: 'var(--color-fig-muted)' }}>
            hit rate{' '}
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-fig-fg)' }}>
              {hitRate}%
            </span>
          </span>
        </div>

        {/* recency lane */}
        <div className="fig-card" style={{ padding: 12 }}>
          <div
            className="font-sans font-semibold mb-2"
            style={{
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--color-fig-muted)',
            }}
          >
            <span className="sm:hidden">recency · MRU (top) → LRU (bottom)</span>
            <span className="hidden sm:inline">recency · MRU (left) → LRU (right)</span>
          </div>
          <div
            className="flex flex-col sm:flex-row"
            style={{ alignItems: 'stretch', gap: 8 }}
          >
            <AnimatePresence initial={false}>
              {frames.map((f, i) => (
                <FrameCard
                  key={f.id}
                  frame={f}
                  rank={i}
                  isMru={i === 0}
                  isLru={i === frames.length - 1 && emptyCount === 0}
                  flash={flashFor(f.id)}
                  onToggleDirty={() => toggleDirty(f.id)}
                  disabled={busy}
                />
              ))}
            </AnimatePresence>
            {Array.from({ length: emptyCount }).map((_, i) => (
              <EmptySlot key={`empty-${i}`} />
            ))}
          </div>
        </div>

        {/* status */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
            minHeight: 38,
          }}
        >
          {status}
        </div>

        {/* manual request */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="page #"
            disabled={busy}
            aria-label="page number to request"
            className="font-mono text-[13px] rounded-md px-2.5 py-2"
            style={{
              width: 100,
              minHeight: 38,
              background: 'var(--color-fig-bg)',
              border: '1px solid rgba(0,0,0,0.18)',
              color: 'var(--color-fig-fg)',
            }}
          />
          <button
            type="button"
            onClick={requestManual}
            disabled={busy}
            className="fig-btn fig-btn-primary"
            style={{ minHeight: 38 }}
          >
            Request page
          </button>
        </div>

        {/* demos */}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={hotRootDemo} disabled={busy} className="fig-btn">
            ▶ B-tree root stays hot
          </button>
          <button type="button" onClick={fillEvictDemo} disabled={busy} className="fig-btn">
            ▶ Fill &amp; evict
          </button>
          <button type="button" onClick={reset} disabled={busy} className="fig-btn fig-btn-danger">
            Reset
          </button>
        </div>

        {/* root callback note */}
        {rootResident && (
          <div
            className="font-sans text-[11px] rounded-md px-3 py-2"
            style={{
              background: 'rgba(47,107,58,0.08)',
              border: '1px solid rgba(47,107,58,0.30)',
              color: 'var(--color-fig-fg)',
            }}
          >
            <span className="font-semibold" style={{ color: COLORS.root }}>
              root
            </span>{' '}
            is still resident — touched on every descent, it never reaches the LRU end, so LRU never
            evicts it. That is why the hot top of a B-tree (ch04) stays in memory.
          </div>
        )}

        {/* pool slider */}
        <div className="space-y-1.5 pt-1">
          <Slider label="pool size (frames)" min={3} max={6} step={1} value={poolSize} onChange={handlePool} />
          <div className="font-sans text-[11px]" style={{ color: 'var(--color-fig-muted)' }}>
            The pool holds {poolSize} frame{poolSize === 1 ? '' : 's'}. A miss into a full pool must
            evict the least-recently-used one before it can read the new page.
          </div>
        </div>
      </div>
    </Figure>
  );
}
