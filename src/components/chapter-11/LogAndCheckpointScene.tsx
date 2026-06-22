import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * LogAndCheckpointScene — chapter 11 scene (Figure 11.2, §3-4).
 *
 * The write-ahead log laid out as a row of LSN-stamped record cards, the
 * per-transaction prevLSN chain drawn as backward arrows over the strip, the
 * pages carrying their pageLSN, and a fuzzy CHECKPOINT that snapshots the
 * dirty-page table (pid -> recLSN) + the active-txn table (tid -> status,
 * lastLSN). The payoff: redo begins at min(recLSN) = redoLSN, NOT at lsn 1 —
 * the checkpoint bounds how far back replay must go.
 *
 * Built by a tiny in-component DB that mirrors the canonical ch11 model
 * (update / commit / flush_page / checkpoint), snapshotting a frame after each
 * step so the log/tables/pages stay perfectly consistent — same field names as
 * the Python sandboxes (lsn, pageLSN, prevLSN, recLSN, status, lastLSN).
 *
 * Cream palette only. Reflows at 390px: the log strip scrolls inside an
 * overflow-x container, the two tables stack, controls wrap full-width.
 */

/* ------------------------------------------------------------------ */
/*  Palette                                                           */
/* ------------------------------------------------------------------ */

const GREEN = 'var(--color-fig-green)';
const BLUE = 'var(--color-fig-blue)';
const ACCENT = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';
const FG = 'var(--color-fig-fg)';
const BG = 'var(--color-fig-bg)';

// Per-transaction colour, used for the prevLSN chain arrows + record accents.
const TXN_COLOR: Record<string, string> = { T1: BLUE, T2: ACCENT };
const colorOf = (tid?: string) => (tid ? TXN_COLOR[tid] ?? MUTED : MUTED);

/* ------------------------------------------------------------------ */
/*  Frame model + a compact mirror of the canonical DB                */
/* ------------------------------------------------------------------ */

interface Rec {
  lsn: number;
  type: 'update' | 'commit' | 'end' | 'checkpoint';
  tid?: string;
  pid?: string;
  before?: number | null;
  after?: number | null;
  prevLSN?: number;
}

interface PageState {
  val: number | null;
  pageLSN: number;
  dirty: boolean;
}

interface Snapshot {
  lsn: number;
  att: Record<string, { status: string; lastLSN: number }>;
  dpt: Record<string, number>;
}

interface Frame {
  note: string;
  phase: string;
  log: Rec[];
  pages: Record<string, PageState>;
  att: Record<string, { status: string; lastLSN: number }>;
  dpt: Record<string, number>;
  snapshot: Snapshot | null; // the checkpoint snapshot, once written
  redoLSN: number | null; // set only on the final frame
  flashPid: string | null; // page touched this step
}

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Build the deterministic frame sequence by running the canonical DB ops. */
function buildFrames(): Frame[] {
  const frames: Frame[] = [];
  const log: Rec[] = [];
  let lsn = 0;
  const pages: Record<string, PageState> = {};
  const att: Record<string, { status: string; lastLSN: number }> = {};
  const dpt: Record<string, number> = {};
  let snapshot: Snapshot | null = null;

  const page = (pid: string): PageState => {
    if (!pages[pid]) pages[pid] = { val: null, pageLSN: 0, dirty: false };
    return pages[pid];
  };
  const update = (tid: string, pid: string, val: number) => {
    const p = page(pid);
    lsn += 1;
    log.push({ lsn, type: 'update', tid, pid, before: p.val, after: val, prevLSN: att[tid]?.lastLSN ?? 0 });
    p.val = val;
    p.pageLSN = lsn;
    p.dirty = true;
    if (!att[tid]) att[tid] = { status: 'U', lastLSN: 0 };
    att[tid].lastLSN = lsn;
    att[tid].status = 'U';
    if (!(pid in dpt)) dpt[pid] = lsn;
  };
  const commit = (tid: string) => {
    lsn += 1;
    log.push({ lsn, type: 'commit', tid, prevLSN: att[tid].lastLSN });
    const c = lsn;
    lsn += 1;
    log.push({ lsn, type: 'end', tid, prevLSN: c });
    delete att[tid];
  };
  const flush = (pid: string) => {
    if (pages[pid]) pages[pid].dirty = false;
    delete dpt[pid];
  };
  const checkpoint = () => {
    lsn += 1;
    snapshot = { lsn, att: clone(att), dpt: clone(dpt) };
    log.push({ lsn, type: 'checkpoint' });
  };

  const snap = (note: string, phase: string, flashPid: string | null, redoLSN: number | null = null) =>
    frames.push({
      note,
      phase,
      log: clone(log),
      pages: clone(pages),
      att: clone(att),
      dpt: clone(dpt),
      snapshot: snapshot ? clone(snapshot) : null,
      redoLSN,
      flashPid,
    });

  // 0 — empty
  snap(
    'A write-ahead log starts empty. Every change appends one LSN-stamped record before the page itself reaches disk. Step through to build the log, take a checkpoint, and see where redo begins.',
    'start',
    null,
  );

  // 1 — T1 updates A
  update('T1', 'A', 100);
  snap('T1 updates page A. Record lsn 1 is logged first (write-ahead); the page now carries pageLSN 1 and A enters the dirty-page table with recLSN 1.', 'log', 'A');

  // 2 — T2 updates B
  update('T2', 'B', 200);
  snap('T2 updates page B — lsn 2, a different transaction. B joins the dirty-page table with recLSN 2.', 'log', 'B');

  // 3 — T1 updates C (chain 3 -> 1)
  update('T1', 'C', 300);
  snap("T1 updates page C — lsn 3. Its prevLSN points back to lsn 1, T1's previous record: the per-transaction chain undo will later walk in reverse.", 'log', 'C');

  // 4 — flush A (steal)
  flush('A');
  snap('STEAL: the buffer pool flushes page A to disk. A is clean again, so it drops out of the dirty-page table — its change is already durable.', 'flush', 'A');

  // 5 — checkpoint
  checkpoint();
  snap('checkpoint() writes lsn 4: a snapshot of the active-txn table and the dirty-page table straight into the log. This is the anchor recovery will start from.', 'checkpoint', null);

  // 6 — T2 updates D (chain 6 -> 2)
  update('T2', 'D', 400);
  snap("T2 updates page D — lsn 5, after the checkpoint. Its prevLSN chains back to lsn 2. The dirty-page table grows; the live tables drift past the snapshot.", 'log', 'D');

  // 7 — T1 commits (chain 6 -> 3, 7 -> 6)
  commit('T1');
  snap("T1 commits — lsn 6 (commit) then lsn 7 (end), chained back through lsn 3. T1 is now a winner; only T2's work is still in flight.", 'commit', null);

  // 8 — redo bound
  const redoLSN = Math.min(...Object.values(dpt));
  snap(
    `Where does redo begin? At min(recLSN) over the dirty-page table = lsn ${redoLSN}. Everything before it is already on disk — page A's lsn 1 change was flushed, so replay skips it. The checkpoint and the dirty-page table together BOUND replay: recovery starts near the crash, not at lsn 1.`,
    'redo',
    null,
    redoLSN,
  );

  return frames;
}

/* ------------------------------------------------------------------ */
/*  Log strip with the prevLSN chain drawn as backward arrows         */
/* ------------------------------------------------------------------ */

const CARD_W = 96;
const GAP = 16;
const ARROW_H = 56;
const TYPE_LABEL: Record<Rec['type'], string> = {
  update: 'update',
  commit: 'commit',
  end: 'end',
  checkpoint: 'checkpoint',
};

function LogStrip({ frame }: { frame: Frame }) {
  const recs = frame.log;
  const n = Math.max(recs.length, 1);
  const totalW = n * CARD_W + (n - 1) * GAP;
  const idxOf = useMemo(() => {
    const m: Record<number, number> = {};
    recs.forEach((r, i) => (m[r.lsn] = i));
    return m;
  }, [recs]);
  const xCenter = (i: number) => i * (CARD_W + GAP) + CARD_W / 2;

  // chain arrows: each record with a same-txn prevLSN that is visible
  const chains = recs
    .filter((r) => r.prevLSN && r.prevLSN > 0 && idxOf[r.prevLSN] !== undefined)
    .map((r) => ({ from: idxOf[r.lsn], to: idxOf[r.prevLSN as number], color: colorOf(r.tid), key: `${r.lsn}` }));

  return (
    <div style={{ width: totalW, minWidth: '100%' }}>
      {/* arrow band */}
      <svg
        width={totalW}
        height={ARROW_H}
        viewBox={`0 0 ${totalW} ${ARROW_H}`}
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="per-transaction prevLSN chains"
      >
        <defs>
          {Object.entries(TXN_COLOR).map(([tid, c]) => (
            <marker
              key={tid}
              id={`chain-arrow-${tid}`}
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill={c} />
            </marker>
          ))}
        </defs>
        <AnimatePresence>
          {chains.map((c) => {
            const xs = xCenter(c.from);
            const xe = xCenter(c.to);
            const span = Math.abs(xs - xe);
            const my = ARROW_H - Math.min(ARROW_H - 8, 18 + span * 0.18);
            const mx = (xs + xe) / 2;
            const tid = Object.keys(TXN_COLOR).find((t) => TXN_COLOR[t] === c.color);
            return (
              <motion.path
                key={c.key}
                initial={{ opacity: 0, pathLength: 0 }}
                animate={{ opacity: 1, pathLength: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                d={`M ${xs} ${ARROW_H} Q ${mx} ${my} ${xe} ${ARROW_H}`}
                fill="none"
                stroke={c.color}
                strokeWidth={1.8}
                markerEnd={tid ? `url(#chain-arrow-${tid})` : undefined}
              />
            );
          })}
        </AnimatePresence>
      </svg>

      {/* record cards */}
      <div style={{ display: 'flex', gap: GAP }}>
        <AnimatePresence>
          {recs.map((r) => {
            const isCkpt = r.type === 'checkpoint';
            const color = isCkpt ? GREEN : colorOf(r.tid);
            const isRedoStart = frame.redoLSN != null && r.lsn === frame.redoLSN;
            const dimmed = frame.redoLSN != null && r.lsn < frame.redoLSN;
            return (
              <motion.div
                key={r.lsn}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: dimmed ? 0.45 : 1, y: 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  width: CARD_W,
                  flex: '0 0 auto',
                  borderRadius: 8,
                  border: `1.5px solid ${isRedoStart ? GREEN : `${color}99`}`,
                  background: isCkpt ? `${GREEN}14` : `${color}0f`,
                  padding: '6px 7px',
                  boxShadow: isRedoStart ? `0 0 0 3px ${GREEN}33` : 'none',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold" style={{ color }}>
                    {isCkpt ? '◆' : r.tid}
                  </span>
                  <span className="font-mono tabular-nums text-[10px]" style={{ color: MUTED }}>
                    lsn {r.lsn}
                  </span>
                </div>
                <div className="font-sans text-[10px] font-semibold mt-0.5" style={{ color: FG }}>
                  {TYPE_LABEL[r.type]}
                </div>
                {r.type === 'update' && (
                  <div className="font-mono text-[10.5px] mt-0.5" style={{ color: FG }}>
                    {r.pid}={r.after}
                  </div>
                )}
                {!isCkpt && (
                  <div className="font-mono text-[9.5px] mt-1" style={{ color: MUTED }}>
                    prev {r.prevLSN ?? 0}
                  </div>
                )}
                {isCkpt && (
                  <div className="font-mono text-[9.5px] mt-1" style={{ color: GREEN }}>
                    ATT+DPT
                  </div>
                )}
                {isRedoStart && (
                  <div
                    className="font-sans text-[9px] font-bold mt-1 text-center rounded"
                    style={{ background: GREEN, color: BG, padding: '1px 2px' }}
                  >
                    REDO ▶
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pages, tables                                                     */
/* ------------------------------------------------------------------ */

function PageChips({ frame }: { frame: Frame }) {
  const pids = Object.keys(frame.pages).sort();
  if (pids.length === 0)
    return (
      <span className="font-mono text-[12px]" style={{ color: MUTED }}>
        (no pages touched yet)
      </span>
    );
  return (
    <div className="flex flex-wrap gap-2">
      {pids.map((pid) => {
        const p = frame.pages[pid];
        const flash = frame.flashPid === pid;
        const c = p.dirty ? ACCENT : GREEN;
        return (
          <motion.span
            key={pid}
            animate={{ scale: flash ? [1, 1.08, 1] : 1 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[12px]"
            style={{ background: BG, border: `1px solid ${c}88`, color: FG }}
          >
            <span style={{ fontWeight: 700 }}>{pid}</span>
            <span style={{ color: MUTED }}>=</span>
            <span style={{ fontWeight: 700 }}>{p.val ?? '∅'}</span>
            <span style={{ color: MUTED }}>·</span>
            <span style={{ color: MUTED }}>pageLSN {p.pageLSN}</span>
            <span
              className="rounded px-1 text-[9.5px] font-sans font-semibold"
              style={{ background: `${c}22`, color: c }}
            >
              {p.dirty ? 'dirty' : 'clean'}
            </span>
          </motion.span>
        );
      })}
    </div>
  );
}

function MiniTable({
  title,
  subtitle,
  rows,
  redoLSN,
}: {
  title: string;
  subtitle: string;
  rows: { key: string; cols: (string | number)[]; mark?: boolean }[];
  redoLSN?: number | null;
}) {
  return (
    <div className="fig-card" style={{ flex: 1, minWidth: 0, padding: '10px 12px' }}>
      <div className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: FG }}>
        {title}
      </div>
      <div className="font-sans text-[10.5px] mb-1.5" style={{ color: MUTED }}>
        {subtitle}
      </div>
      {rows.length === 0 ? (
        <div className="font-mono text-[11.5px]" style={{ color: MUTED }}>
          (empty)
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-2 font-mono text-[12px] rounded px-1.5 py-0.5"
              style={{
                color: FG,
                background: r.mark ? `${GREEN}1a` : 'transparent',
                border: r.mark ? `1px solid ${GREEN}66` : '1px solid transparent',
              }}
            >
              {r.cols.map((c, i) => (
                <span key={i} style={{ fontWeight: i === 0 ? 700 : 400, color: i === 0 ? FG : MUTED }}>
                  {c}
                </span>
              ))}
              {r.mark && redoLSN != null && (
                <span className="ml-auto font-sans text-[9.5px] font-bold" style={{ color: GREEN }}>
                  redoLSN
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export default function LogAndCheckpointScene() {
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
    const delay = 1100 - speed * 140;
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
  const back = () => {
    setPlaying(false);
    setIdx((i) => Math.max(i - 1, 0));
  };
  const reset = () => {
    setPlaying(false);
    setIdx(0);
  };

  // dirty-page-table rows, marking the redoLSN (min recLSN) row
  const dptEntries = Object.entries(frame.dpt).sort((a, b) => a[0].localeCompare(b[0]));
  const minRec = dptEntries.length ? Math.min(...dptEntries.map(([, v]) => v)) : null;
  const dptRows = dptEntries.map(([pid, rec]) => ({
    key: pid,
    cols: [`page ${pid}`, `recLSN ${rec}`],
    mark: frame.redoLSN != null && rec === minRec,
  }));
  const attRows = Object.entries(frame.att)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([tid, info]) => ({ key: tid, cols: [tid, `${info.status}`, `lastLSN ${info.lastLSN}`] }));

  return (
    <Figure
      number="11.2"
      caption="The write-ahead log as a row of LSN-stamped records, with each transaction's prevLSN chain drawn as backward arrows (T1 blue, T2 orange). Pages carry their pageLSN; the dirty-page table holds pid → recLSN and the active-txn table holds tid → status, lastLSN. A fuzzy checkpoint snapshots both tables into the log, and redo begins at min(recLSN) = redoLSN — never at lsn 1, because already-flushed changes are skipped. The checkpoint bounds how far back recovery must replay. On a narrow screen the log strip scrolls and the tables stack."
    >
      <div className="space-y-4">
        {/* phase pill + step counter */}
        <div
          className="flex flex-wrap items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold"
            style={{
              background: BG,
              border: `1px solid ${frame.phase === 'checkpoint' ? GREEN : frame.phase === 'redo' ? GREEN : 'rgba(0,0,0,0.14)'}`,
              color: frame.phase === 'checkpoint' || frame.phase === 'redo' ? GREEN : MUTED,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 99,
                background: frame.phase === 'checkpoint' || frame.phase === 'redo' ? GREEN : ACCENT,
                display: 'inline-block',
              }}
            />
            {frame.phase}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* log strip — scrolls horizontally at 390px */}
        <div
          className="fig-card"
          style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}
        >
          <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            write-ahead log
          </div>
          <LogStrip frame={frame} />
        </div>

        {/* pages */}
        <div className="fig-card" style={{ padding: '10px 12px' }}>
          <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            pages (val · pageLSN)
          </div>
          <PageChips frame={frame} />
        </div>

        {/* tables — side by side on wide, stacked at 390px */}
        <div className="flex flex-col sm:flex-row gap-3">
          <MiniTable
            title="dirty-page table"
            subtitle="pid → recLSN"
            rows={dptRows}
            redoLSN={frame.redoLSN}
          />
          <MiniTable title="active-txn table" subtitle="tid → status, lastLSN" rows={attRows} />
        </div>

        {/* checkpoint snapshot, once written */}
        <AnimatePresence>
          {frame.snapshot && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="fig-card"
              style={{ padding: '10px 12px', borderColor: `${GREEN}66`, overflow: 'hidden' }}
            >
              <div className="font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: GREEN }}>
                ◆ checkpoint snapshot @ lsn {frame.snapshot.lsn}
              </div>
              <div className="font-mono text-[11.5px] mt-1.5" style={{ color: FG }}>
                ATT&nbsp;
                <span style={{ color: MUTED }}>
                  {'{'}
                  {Object.entries(frame.snapshot.att)
                    .map(([t, i]) => `${t}: (${i.status}, ${i.lastLSN})`)
                    .join(', ') || '∅'}
                  {'}'}
                </span>
              </div>
              <div className="font-mono text-[11.5px] mt-0.5" style={{ color: FG }}>
                DPT&nbsp;
                <span style={{ color: MUTED }}>
                  {'{'}
                  {Object.entries(frame.snapshot.dpt)
                    .map(([p, r]) => `${p}: ${r}`)
                    .join(', ') || '∅'}
                  {'}'}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* status line */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: FG,
            minHeight: 56,
          }}
        >
          {frame.note}
        </div>

        {/* controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={play} className="fig-btn fig-btn-primary" style={{ minHeight: 38 }}>
            {atEnd ? 'Replay' : playing ? 'Playing…' : 'Play'}
          </button>
          <button type="button" onClick={back} disabled={idx === 0} className="fig-btn" style={{ minHeight: 38 }}>
            Back
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
