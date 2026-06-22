import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * ThreePassesScene — chapter 11 HERO scene (Figure 11.3).
 *
 * The whole of ARIES in one animation: a crash leaves a torn disk, then the three
 * passes mend it — Analysis (rebuild the tables, forward), Redo (repeat history,
 * forward), Undo (roll back losers, backward).
 *
 * Fixed scenario (matches the REDO/UNDO sandboxes' shape):
 *   LSN 1  T1 update A 0->10
 *   LSN 2  T2 update B 0->20
 *   LSN 3  checkpoint        ATT={T1,T2 running}  DPT={A:1, B:2}
 *   LSN 4  T1 update C 0->30
 *   LSN 5  T1 commit         -> T1 is a WINNER
 *   LSN 6  T2 update D 0->40  -> T2 never commits: LOSER
 *   --- crash ---
 * Disk at crash (steal/no-force): A,C,D never flushed; B was STOLEN to disk.
 *   so disk = {A:old, B:20, C:old, D:old}, only B carries a pageLSN.
 * Redo: replay 1,4,6 (apply) and skip 2 (B already on disk, pageLSN check).
 * Undo: reverse T2 along its chain 6 -> 2, writing CLRs; final disk has T1's
 *   committed A,C and T2's B,D reversed.
 *
 * Cream palette only. Reflows at 390px: panels stack, the log strip scrolls
 * inside the figure, controls wrap.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const BLUE = 'var(--color-fig-blue)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

type Pass = 'crash' | 'analysis' | 'redo' | 'undo' | 'done';
type TStatus = 'running' | 'committed';

interface LogRec {
  lsn: number;
  kind: 'update' | 'commit' | 'checkpoint' | 'clr' | 'end';
  txn?: 'T1' | 'T2';
  page?: string;
  val?: number | null;
}

interface PageState {
  val: number | null;
  pageLSN: number;
  tag?: 'applied' | 'skipped' | 'reverted' | null;
}

interface Frame {
  pass: Pass;
  activeLSN: number | null; // highlighted log record
  dir: 'fwd' | 'bwd' | null;
  att: Record<string, TStatus>;
  dpt: Record<string, number>;
  disk: Record<string, PageState>;
  redoLSN: number | null;
  losers: string[];
  clrs: number[]; // lsns of CLRs written so far
  note: string;
}

const PAGES = ['A', 'B', 'C', 'D'] as const;

// The base (durable) log. Undo will append CLRs 7,8 and end 9 during the run.
const BASE_LOG: LogRec[] = [
  { lsn: 1, kind: 'update', txn: 'T1', page: 'A', val: 10 },
  { lsn: 2, kind: 'update', txn: 'T2', page: 'B', val: 20 },
  { lsn: 3, kind: 'checkpoint' },
  { lsn: 4, kind: 'update', txn: 'T1', page: 'C', val: 30 },
  { lsn: 5, kind: 'commit', txn: 'T1' },
  { lsn: 6, kind: 'update', txn: 'T2', page: 'D', val: 40 },
];

const CLR_LOG: LogRec[] = [
  { lsn: 7, kind: 'clr', txn: 'T2', page: 'D', val: 0 },
  { lsn: 8, kind: 'clr', txn: 'T2', page: 'B', val: 0 },
  { lsn: 9, kind: 'end', txn: 'T2' },
];

function disk(
  a: [number | null, number],
  b: [number | null, number],
  c: [number | null, number],
  d: [number | null, number],
  tags: Partial<Record<string, PageState['tag']>> = {},
): Record<string, PageState> {
  return {
    A: { val: a[0], pageLSN: a[1], tag: tags.A ?? null },
    B: { val: b[0], pageLSN: b[1], tag: tags.B ?? null },
    C: { val: c[0], pageLSN: c[1], tag: tags.C ?? null },
    D: { val: d[0], pageLSN: d[1], tag: tags.D ?? null },
  };
}

function buildFrames(): Frame[] {
  const f: Frame[] = [];
  // Disk at crash: A,C,D old (pageLSN 0); B stolen to disk (val 20, pageLSN 2).
  const crashDisk = disk([null, 0], [20, 2], [null, 0], [null, 0]);

  f.push({
    pass: 'crash',
    activeLSN: null,
    dir: null,
    att: {},
    dpt: {},
    disk: crashDisk,
    redoLSN: null,
    losers: [],
    clrs: [],
    note: 'A crash. The log survived; the disk is torn — B (uncommitted) was stolen to disk, while committed A and C never reached it. Three passes will mend it.',
  });

  // ---- ANALYSIS (forward from the checkpoint) ----
  f.push({
    pass: 'analysis',
    activeLSN: 3,
    dir: 'fwd',
    att: { T1: 'running', T2: 'running' },
    dpt: { A: 1, B: 2 },
    disk: crashDisk,
    redoLSN: null,
    losers: [],
    clrs: [],
    note: 'Analysis starts at the last checkpoint (LSN 3): it adopts the snapshot — ATT {T1, T2 running}, DPT {A→1, B→2} — and scans forward.',
  });
  f.push({
    pass: 'analysis',
    activeLSN: 4,
    dir: 'fwd',
    att: { T1: 'running', T2: 'running' },
    dpt: { A: 1, B: 2, C: 4 },
    disk: crashDisk,
    redoLSN: null,
    losers: [],
    clrs: [],
    note: 'LSN 4: T1 updates C. C enters the dirty-page table with recLSN 4; T1 stays active.',
  });
  f.push({
    pass: 'analysis',
    activeLSN: 5,
    dir: 'fwd',
    att: { T1: 'committed', T2: 'running' },
    dpt: { A: 1, B: 2, C: 4 },
    disk: crashDisk,
    redoLSN: null,
    losers: [],
    clrs: [],
    note: 'LSN 5: T1 commits. In the ATT, T1 flips to committed — a winner.',
  });
  f.push({
    pass: 'analysis',
    activeLSN: 6,
    dir: 'fwd',
    att: { T1: 'committed', T2: 'running' },
    dpt: { A: 1, B: 2, C: 4, D: 6 },
    disk: crashDisk,
    redoLSN: null,
    losers: [],
    clrs: [],
    note: 'LSN 6: T2 updates D. D enters the DPT (recLSN 6). End of log reached.',
  });
  f.push({
    pass: 'analysis',
    activeLSN: null,
    dir: null,
    att: { T1: 'committed', T2: 'running' },
    dpt: { A: 1, B: 2, C: 4, D: 6 },
    disk: crashDisk,
    redoLSN: 1,
    losers: ['T2'],
    clrs: [],
    note: 'Analysis done. redoLSN = min recLSN = 1 (where Redo begins). Loser set = {T2} — still running, never committed, so Undo must roll it back.',
  });

  // ---- REDO (forward from redoLSN) ----
  const att = { T1: 'committed' as TStatus, T2: 'running' as TStatus };
  const dpt = { A: 1, B: 2, C: 4, D: 6 };
  f.push({
    pass: 'redo',
    activeLSN: 1,
    dir: 'fwd',
    att,
    dpt,
    disk: disk([10, 1], [20, 2], [null, 0], [null, 0], { A: 'applied' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [],
    note: 'Redo, LSN 1: disk pageLSN 0 < 1 → APPLY. A is restored to 10 (the committed change the crash lost).',
  });
  f.push({
    pass: 'redo',
    activeLSN: 2,
    dir: 'fwd',
    att,
    dpt,
    disk: disk([10, 1], [20, 2], [null, 0], [null, 0], { B: 'skipped' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [],
    note: 'Redo, LSN 2: disk pageLSN 2 ≥ 2 → SKIP. B already holds this change (it was stolen to disk before the crash). The pageLSN check makes redo idempotent.',
  });
  f.push({
    pass: 'redo',
    activeLSN: 4,
    dir: 'fwd',
    att,
    dpt,
    disk: disk([10, 1], [20, 2], [30, 4], [null, 0], { C: 'applied' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [],
    note: 'Redo, LSN 4: disk pageLSN 0 < 4 → APPLY. C is restored to 30.',
  });
  f.push({
    pass: 'redo',
    activeLSN: 6,
    dir: 'fwd',
    att,
    dpt,
    disk: disk([10, 1], [20, 2], [30, 4], [40, 6], { D: 'applied' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [],
    note: 'Redo, LSN 6: APPLY. D = 40 — a LOSER’s change, replayed anyway. History is repeated in full; the disk now matches the pre-crash buffer exactly.',
  });

  // ---- UNDO (backward along T2's chain 6 -> 2) ----
  f.push({
    pass: 'undo',
    activeLSN: 6,
    dir: 'bwd',
    att,
    dpt,
    disk: disk([10, 1], [20, 2], [30, 4], [0, 7], { D: 'reverted' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [7],
    note: 'Undo, LSN 6 (T2’s newest): reverse D back to 0 and log a CLR (LSN 7) recording the reversal. Follow T2’s prevLSN chain to LSN 2.',
  });
  f.push({
    pass: 'undo',
    activeLSN: 2,
    dir: 'bwd',
    att,
    dpt,
    disk: disk([10, 1], [0, 8], [30, 4], [0, 7], { B: 'reverted' }),
    redoLSN: 1,
    losers: ['T2'],
    clrs: [7, 8],
    note: 'Undo, LSN 2: reverse B back to 0, log CLR (LSN 8). T2’s chain ends (prevLSN 0) → write its end record. T2 is fully rolled back.',
  });
  f.push({
    pass: 'done',
    activeLSN: null,
    dir: null,
    att: { T1: 'committed' },
    dpt,
    disk: disk([10, 1], [0, 8], [30, 4], [0, 7]),
    redoLSN: 1,
    losers: [],
    clrs: [7, 8],
    note: 'Recovery complete. Committed T1 is present (A=10, C=30); uncommitted T2 is reversed (B=0, D=0). The disk finally tells the truth.',
  });

  return f;
}

const PASS_META: { id: Pass; label: string }[] = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'redo', label: 'Redo' },
  { id: 'undo', label: 'Undo' },
];

function passColor(p: Pass): string {
  if (p === 'analysis') return BLUE;
  if (p === 'redo') return GREEN;
  if (p === 'undo') return ORANGE;
  if (p === 'done') return GREEN;
  return RED;
}

function LogStrip({ frame }: { frame: Frame }) {
  const recs = [...BASE_LOG];
  if (frame.clrs.includes(7)) recs.push(CLR_LOG[0]);
  if (frame.clrs.includes(8)) recs.push(CLR_LOG[1], CLR_LOG[2]);
  return (
    <div
      className="fig-card"
      style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          log
        </span>
        {frame.dir && (
          <span className="font-mono text-[11px]" style={{ color: passColor(frame.pass) }}>
            {frame.dir === 'fwd' ? 'scanning forward →' : '← scanning backward'}
          </span>
        )}
      </div>
      <div className="flex gap-1.5" style={{ minWidth: 'min-content' }}>
        {recs.map((r) => {
          const active = frame.activeLSN === r.lsn;
          const isRedoStart = frame.redoLSN === r.lsn && frame.pass !== 'crash';
          const c =
            r.kind === 'commit' || r.kind === 'end'
              ? BLUE
              : r.kind === 'checkpoint'
                ? MUTED
                : r.kind === 'clr'
                  ? ORANGE
                  : 'var(--color-fig-fg)';
          return (
            <motion.div
              key={r.lsn}
              animate={{ scale: active ? 1.06 : 1 }}
              className="rounded px-1.5 py-1 text-center font-mono"
              style={{
                minWidth: 56,
                background: active ? `${passColor(frame.pass)}1f` : 'var(--color-fig-bg)',
                border: `1.5px solid ${active ? passColor(frame.pass) : isRedoStart ? GREEN : 'rgba(0,0,0,0.14)'}`,
                color: c,
              }}
            >
              <div className="text-[11px] font-bold">#{r.lsn}</div>
              <div className="text-[10px] leading-tight" style={{ color: MUTED }}>
                {r.kind === 'checkpoint'
                  ? 'chkpt'
                  : r.kind === 'commit'
                    ? `commit ${r.txn}`
                    : r.kind === 'end'
                      ? `end ${r.txn}`
                      : `${r.txn} ${r.page}=${r.val}`}
              </div>
              {r.kind === 'clr' && (
                <div className="text-[9px] font-bold" style={{ color: ORANGE }}>
                  CLR
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function Tables({ frame }: { frame: Frame }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="fig-card" style={{ flex: 1, minWidth: 0 }}>
        <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          txn table (ATT)
        </div>
        {Object.keys(frame.att).length === 0 ? (
          <div className="font-mono text-[12px]" style={{ color: MUTED }}>
            —
          </div>
        ) : (
          Object.entries(frame.att).map(([t, s]) => {
            const loser = frame.losers.includes(t);
            return (
              <div key={t} className="flex items-center justify-between font-mono text-[12.5px]">
                <span style={{ fontWeight: 700, color: 'var(--color-fig-fg)' }}>{t}</span>
                <span style={{ color: s === 'committed' ? BLUE : loser ? ORANGE : MUTED }}>
                  {s}
                  {loser ? ' · loser' : s === 'committed' ? ' · winner' : ''}
                </span>
              </div>
            );
          })
        )}
      </div>
      <div className="fig-card" style={{ flex: 1, minWidth: 0 }}>
        <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          dirty page table
        </div>
        {Object.keys(frame.dpt).length === 0 ? (
          <div className="font-mono text-[12px]" style={{ color: MUTED }}>
            —
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(frame.dpt).map(([p, rec]) => (
              <span
                key={p}
                className="font-mono text-[12px]"
                style={{
                  padding: '1px 7px',
                  borderRadius: 5,
                  background: 'var(--color-fig-bg)',
                  border: `1px solid ${frame.redoLSN === rec ? GREEN : 'rgba(0,0,0,0.14)'}`,
                  color: 'var(--color-fig-fg)',
                }}
              >
                {p}→{rec}
              </span>
            ))}
          </div>
        )}
        {frame.redoLSN != null && (
          <div className="mt-1 font-mono text-[11px]" style={{ color: GREEN }}>
            redoLSN = {frame.redoLSN}
          </div>
        )}
      </div>
    </div>
  );
}

const TAG_META: Record<string, { color: string; label: string }> = {
  applied: { color: GREEN, label: 'redone' },
  skipped: { color: MUTED, label: 'skip · idempotent' },
  reverted: { color: ORANGE, label: 'undone' },
};

function Pages({ frame }: { frame: Frame }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PAGES.map((p) => {
        const st = frame.disk[p];
        const tag = st.tag ? TAG_META[st.tag] : null;
        const committed = (p === 'A' || p === 'C') && frame.pass === 'done';
        const border = tag ? tag.color : committed ? GREEN : 'rgba(0,0,0,0.14)';
        return (
          <motion.div
            key={p}
            layout
            className="rounded-md px-2.5 py-1.5 font-mono"
            style={{ background: 'var(--color-fig-bg)', border: `1.5px solid ${border}`, minWidth: 84 }}
          >
            <div className="flex items-center justify-between gap-2">
              <span style={{ fontWeight: 700, color: 'var(--color-fig-fg)' }}>page {p}</span>
              <span className="text-[10px]" style={{ color: MUTED }}>
                LSN {st.pageLSN}
              </span>
            </div>
            <div className="text-[15px] font-bold" style={{ color: st.val == null ? MUTED : 'var(--color-fig-fg)' }}>
              {st.val == null ? '—' : st.val}
            </div>
            {tag && (
              <div className="text-[10px] font-semibold" style={{ color: tag.color }}>
                {tag.label}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export default function ThreePassesScene() {
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
    const delay = 1100 - speed * 150;
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

  return (
    <Figure
      number="11.3"
      caption="The three passes of ARIES recovery. A crash leaves the disk torn; Analysis scans forward from the checkpoint to rebuild the transaction and dirty-page tables (finding redoLSN and the losers), Redo sweeps forward repeating history (idempotent via the pageLSN check), and Undo sweeps backward rolling the losers back with compensation records. Analysis and Redo go forward through history; Undo goes against it. The end state: committed work present, uncommitted reversed. On a narrow screen the panels stack and the log scrolls."
    >
      <div className="space-y-4">
        {/* pass indicator */}
        <div className="flex flex-wrap items-center gap-2">
          {PASS_META.map((p, i) => {
            const active = frame.pass === p.id;
            const done =
              PASS_META.findIndex((x) => x.id === frame.pass) > i ||
              frame.pass === 'done';
            const c = passColor(p.id);
            return (
              <React.Fragment key={p.id}>
                {i > 0 && <span style={{ color: MUTED }}>›</span>}
                <span
                  className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-semibold font-sans"
                  style={{
                    background: active ? `${c}1f` : 'var(--color-fig-bg)',
                    border: `1px solid ${active || done ? c : 'rgba(0,0,0,0.14)'}`,
                    color: active || done ? c : MUTED,
                  }}
                >
                  {p.label}
                  {p.id === 'analysis' || p.id === 'redo' ? ' →' : ' ←'}
                </span>
              </React.Fragment>
            );
          })}
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        <LogStrip frame={frame} />
        <Tables frame={frame} />
        <Pages frame={frame} />

        {/* note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
            minHeight: 58,
          }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={run} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {idx === 0 ? 'Run recovery' : 'Replay'}
          </button>
          <button type="button" onClick={step} disabled={atEnd} className="fig-btn" style={{ minHeight: 38 }}>
            Step
          </button>
          <button type="button" onClick={reset} className="fig-btn fig-btn-danger" style={{ minHeight: 38 }}>
            Reset
          </button>
        </div>
        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
