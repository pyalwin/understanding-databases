import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * CompactionScene — chapter 10 HERO scene (Figure 10.3).
 *
 * The defining image of log-structured storage: SSTables pile up newest-on-top,
 * a read walks them newest-first (read amplification), then COMPACTION merges
 * every table into one — superseded values and tombstones dropping out as the
 * stack collapses — and the same read now touches a single table.
 *
 * Deterministic frame sequence (mirrors COMPACTION_SANDBOX exactly):
 *
 *   stack    4 SSTables on disk, newest on top
 *   read ✗   get('alice') scans 3 tables to find the newest value  (read amp)
 *   merge    compaction begins: oldest→newest, newest value per key wins
 *   drop     superseded versions (alice=v1, carol=v1, bob=v1) + the bob tombstone fade out
 *   one      four tables collapse into one compacted SSTable
 *   read ✓   the same get('alice') now hits a single table         (read amp gone)
 *
 * Cream palette only. Reflows at 390px: the table cards are full-width and their
 * key chips wrap; the read-amplification meter stacks under the stack; controls wrap.
 */

/* ------------------------------------------------------------------ */
/*  Palette                                                           */
/* ------------------------------------------------------------------ */

const RED = 'var(--color-fig-red)';
const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

const TOMBSTONE = '__TOMBSTONE__';

/* ------------------------------------------------------------------ */
/*  Frame model                                                       */
/* ------------------------------------------------------------------ */

type EntryState = 'live' | 'superseded' | 'tombstone' | 'survivor';

interface Entry {
  key: string;
  val: string; // value, or TOMBSTONE for a delete marker
  state: EntryState;
}

interface Table {
  id: string;
  role: 'newest' | 'oldest' | '';
  merging: boolean; // glows as part of an in-progress compaction
  entries: Entry[];
}

interface ReadInfo {
  key: string;
  order: string[]; // table ids touched, in scan order (newest-first)
  foundIn: string; // table id where the newest version was found
  count: number; // tables scanned == read amplification
}

interface Frame {
  phase: string;
  note: string;
  tables: Table[];
  read: ReadInfo | null;
  ampBefore: number | null;
  ampAfter: number | null;
  dropping: boolean; // dead chips visibly dropping out this frame
}

function e(key: string, val: string, state: EntryState = 'live'): Entry {
  return { key, val, state };
}

// The four SSTables on disk, newest-first — identical to the sandbox workload.
function baseStack(markDead: boolean): Table[] {
  const sup = (k: string, v: string): Entry => e(k, v, markDead ? 'superseded' : 'live');
  return [
    { id: 'T0', role: 'newest', merging: false, entries: [e('carol', 'v2'), e('eve', 'v1')] },
    { id: 'T1', role: '', merging: false, entries: [e('bob', TOMBSTONE, 'tombstone'), e('dave', 'v1')] },
    { id: 'T2', role: '', merging: false, entries: [e('alice', 'v2'), sup('carol', 'v1')] },
    { id: 'T3', role: 'oldest', merging: false, entries: [sup('alice', 'v1'), sup('bob', 'v1')] },
  ];
}

const COMPACTED: Table[] = [
  {
    id: 'C',
    role: 'newest',
    merging: false,
    entries: [
      e('alice', 'v2', 'survivor'),
      e('carol', 'v2', 'survivor'),
      e('dave', 'v1', 'survivor'),
      e('eve', 'v1', 'survivor'),
    ],
  },
];

function withMerging(tables: Table[]): Table[] {
  return tables.map((t) => ({ ...t, merging: true }));
}

function buildFrames(): Frame[] {
  const frames: Frame[] = [];

  // 0 — the stack
  frames.push({
    phase: 'stack',
    note: 'Four SSTables on disk, newest on top. Each is immutable and internally sorted. A read checks them newest-first and stops at the first hit — so the more tables pile up, the more a read may have to walk.',
    tables: baseStack(false),
    read: null,
    ampBefore: null,
    ampAfter: null,
    dropping: false,
  });

  // 1 — read BEFORE (read amplification)
  frames.push({
    phase: 'read ✗',
    note: "get('alice'): newest-first, the read checks T0 (no), T1 (no), then finds alice=v2 in T2 — three tables touched for one key. That is READ AMPLIFICATION: every dead version sitting above the live one costs a read.",
    tables: baseStack(false),
    read: { key: 'alice', order: ['T0', 'T1', 'T2'], foundIn: 'T2', count: 3 },
    ampBefore: 3,
    ampAfter: null,
    dropping: false,
  });

  // 2 — compaction begins
  frames.push({
    phase: 'merge',
    note: 'Compaction merges every SSTable into one. It walks them oldest → newest, so the newest value of each key overwrites the older ones. The four tables light up — they are about to become a single table.',
    tables: withMerging(baseStack(false)),
    read: null,
    ampBefore: 3,
    ampAfter: null,
    dropping: false,
  });

  // 3 — drop the dead
  frames.push({
    phase: 'drop',
    note: 'The losers fall out: alice=v1 and carol=v1 (superseded by newer versions) and bob=v1 with its tombstone (a delete cancels the key entirely). Only the newest live value of each surviving key is kept.',
    tables: withMerging(baseStack(true)),
    read: null,
    ampBefore: 3,
    ampAfter: null,
    dropping: true,
  });

  // 4 — one compacted table
  frames.push({
    phase: 'one',
    note: 'Four tables collapse into one compacted SSTable: alice=v2, carol=v2, dave=v1, eve=v1 — sorted, no duplicates, no tombstone. bob is truly gone; there is no longer any marker left to find.',
    tables: COMPACTED,
    read: null,
    ampBefore: 3,
    ampAfter: null,
    dropping: false,
  });

  // 5 — read AFTER (amplification gone)
  frames.push({
    phase: 'read ✓',
    note: "The same get('alice') now hits a single table and returns v2 immediately — read amplification gone. Compaction paid a one-time WRITE (rewriting the survivors) to make every future read cheap. That trade is the heart of an LSM-tree.",
    tables: COMPACTED,
    read: { key: 'alice', order: ['C'], foundIn: 'C', count: 1 },
    ampBefore: 3,
    ampAfter: 1,
    dropping: false,
  });

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Key chip                                                          */
/* ------------------------------------------------------------------ */

function KeyChip({ entry, dropping }: { entry: Entry; dropping: boolean }) {
  const isTomb = entry.state === 'tombstone' || entry.val === TOMBSTONE;
  const dead = entry.state === 'superseded' || isTomb;
  const survivor = entry.state === 'survivor';

  const border = isTomb ? RED : entry.state === 'superseded' ? ACCENT : survivor ? GREEN : 'rgba(0,0,0,0.16)';
  const bg = isTomb ? `${RED}14` : entry.state === 'superseded' ? `${ACCENT}14` : survivor ? `${GREEN}16` : BG;
  const valColor = isTomb ? RED : survivor ? GREEN : FG;
  const display = isTomb ? 'DEL' : entry.val;

  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{
        opacity: dead && dropping ? 0.35 : 1,
        scale: 1,
        y: dead && dropping ? 6 : 0,
      }}
      exit={{ opacity: 0, scale: 0.7, y: 18 }}
      transition={{ duration: 0.4 }}
      className="inline-flex items-center gap-1 font-mono text-[12.5px]"
      style={{
        padding: '2px 8px',
        borderRadius: 6,
        border: `1px solid ${border}`,
        background: bg,
        color: valColor,
        fontWeight: 700,
        textDecoration: dead && dropping ? 'line-through' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: dead && dropping ? MUTED : FG }}>{entry.key}</span>
      <span style={{ color: MUTED }}>=</span>
      <span>{display}</span>
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/*  SSTable card                                                      */
/* ------------------------------------------------------------------ */

function TableCard({
  table,
  frame,
  scanIndex,
}: {
  table: Table;
  frame: Frame;
  scanIndex: number | null; // 1-based scan order during a read, else null
}) {
  const read = frame.read;
  const touched = scanIndex != null;
  const found = read != null && read.foundIn === table.id;

  const ring = found ? GREEN : touched ? BLUE : table.merging ? BLUE : 'rgba(0,0,0,0.12)';
  const ringW = found || touched || table.merging ? 2 : 1;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10 }}
      animate={{
        opacity: 1,
        y: 0,
        boxShadow: found
          ? `0 0 0 3px ${GREEN}33`
          : touched
            ? `0 0 0 3px ${BLUE}26`
            : table.merging
              ? `0 0 0 3px ${BLUE}1f`
              : '0 1px 0 rgba(0,0,0,0.04)',
      }}
      exit={{ opacity: 0, scale: 0.92, y: 12 }}
      transition={{ duration: 0.4 }}
      className="fig-card"
      style={{ borderColor: ring, borderWidth: ringW, padding: '8px 10px' }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-[12px] font-bold" style={{ color: FG }}>
            {table.id === 'C' ? 'SSTable (compacted)' : `SSTable ${table.id}`}
          </span>
          {table.role && (
            <span
              className="rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: BG,
                border: `1px solid ${table.role === 'newest' ? BLUE : MUTED}`,
                color: table.role === 'newest' ? BLUE : MUTED,
              }}
            >
              {table.role}
            </span>
          )}
        </span>
        {touched && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-bold"
            style={{
              background: found ? `${GREEN}1a` : `${BLUE}14`,
              border: `1px solid ${found ? GREEN : BLUE}`,
              color: found ? GREEN : BLUE,
            }}
          >
            {found ? `✓ scan ${scanIndex}` : `scan ${scanIndex}`}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <AnimatePresence mode="popLayout">
          {table.entries.map((en) => (
            <KeyChip key={`${table.id}:${en.key}:${en.val}`} entry={en} dropping={frame.dropping} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Read-amplification meter                                          */
/* ------------------------------------------------------------------ */

function AmpStat({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  const active = value != null;
  return (
    <div
      className="flex-1 rounded-md px-3 py-2"
      style={{
        minWidth: 0,
        background: active ? `${tone}12` : 'rgba(0,0,0,0.03)',
        border: `1px solid ${active ? tone : 'rgba(0,0,0,0.1)'}`,
      }}
    >
      <div className="font-sans text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] font-bold tabular-nums" style={{ color: active ? tone : MUTED }}>
          {active ? value : '—'}
        </span>
        <span className="font-sans text-[11px]" style={{ color: MUTED }}>
          {value === 1 ? 'table scanned' : 'tables scanned'}
        </span>
      </div>
      {/* tiny bar: one segment per table touched */}
      <div className="mt-1.5 flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              background: active && i < (value ?? 0) ? tone : 'rgba(0,0,0,0.1)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function CompactionScene() {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(3);

  const frames = useMemo(() => buildFrames(), []);
  const frame = frames[Math.min(idx, frames.length - 1)];
  const atEnd = idx >= frames.length - 1;

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const delay = 1150 - speed * 130; // speed 1→1020ms … 5→500ms (the merge wants a beat)
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

  const play = () => {
    if (atEnd) setIdx(0);
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

  // scan-order lookup for the read overlay
  const scanIndexOf = (id: string): number | null => {
    if (!frame.read) return null;
    const i = frame.read.order.indexOf(id);
    return i === -1 ? null : i + 1;
  };

  const phaseTone =
    frame.phase === 'read ✓' ? GREEN : frame.phase === 'read ✗' ? ACCENT : frame.phase === 'one' ? GREEN : BLUE;

  return (
    <Figure
      number="10.3"
      caption="Compaction in a log-structured store. SSTables pile up newest-on-top, and a read walks them newest-first — so reading one key may touch many tables (read amplification). Compaction merges every table into one, oldest→newest: the newest value of each key wins, superseded versions and tombstones drop out, and four tables collapse into a single compacted SSTable. The same read then touches just one table. The merge pays a one-time write to make every future read cheap. On a narrow screen the cards and the read-amp meter stack."
    >
      <div className="space-y-4">
        {/* phase pill + step counter */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: BG, border: `1px solid ${phaseTone}`, color: phaseTone }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: phaseTone, display: 'inline-block' }} />
            {frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* the SSTable stack — the disk */}
        <div className="fig-card" style={{ background: 'rgba(0,0,0,0.02)', padding: '10px 12px' }}>
          <div
            className="mb-2 flex items-center justify-between font-sans text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: MUTED }}
          >
            <span>on disk · newest on top</span>
            <span className="font-mono normal-case tracking-normal">
              {frame.tables.length} {frame.tables.length === 1 ? 'SSTable' : 'SSTables'}
            </span>
          </div>
          <motion.div layout className="flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {frame.tables.map((t) => (
                <TableCard key={t.id} table={t} frame={frame} scanIndex={scanIndexOf(t.id)} />
              ))}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* read-amplification meter — before vs after */}
        <div className="flex flex-col sm:flex-row gap-3">
          <AmpStat label="read amp · before" value={frame.ampBefore} tone={ACCENT} />
          <AmpStat label="read amp · after compaction" value={frame.ampAfter} tone={GREEN} />
        </div>

        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: FG,
            minHeight: 58,
          }}
        >
          {frame.note}
        </div>

        {/* transport controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {atEnd ? 'Replay' : idx === 0 ? 'Compact' : 'Play'}
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
