import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider } from '@/components/scene';

/*
 * CLRScene — chapter 11, Figure 11.4.
 *
 * The restartability payoff: a crash DURING recovery is survivable because
 * undo logs compensation records (CLRs) that are redo-only and carry an
 * undoNextLSN. Scenario: loser T2 made two changes —
 *   LSN 1  T2 X 0->20
 *   LSN 2  T2 Y 0->40   (prevLSN 1)
 * Undo reverses Y (writes CLR 3, undoNext=1); then a SECOND crash strikes with
 * only CLR 3 durable. On restart, Redo replays CLR 3 (it is redone, never
 * re-undone), and Undo resumes from undoNext=1 to reverse X — so each change is
 * undone exactly once.
 *
 * Cream palette only; reflows at 390px.
 */

const GREEN = 'var(--color-fig-green)';
const RED = 'var(--color-fig-red)';
const ORANGE = 'var(--color-fig-orange)';
const MUTED = 'var(--color-fig-muted)';

interface Rec {
  lsn: number;
  label: string;
  kind: 'update' | 'clr' | 'end';
  undoNext?: number;
  durable: boolean; // present in the log at this frame
}

interface Frame {
  phase: 'start' | 'undo' | 'crash' | 'redo' | 'resume' | 'done';
  recs: Rec[];
  activeLSN: number | null;
  x: number | null;
  y: number | null;
  xTag?: string | null;
  yTag?: string | null;
  cursor: string; // textual "next to undo" pointer
  note: string;
}

function buildFrames(): Frame[] {
  const base: Rec[] = [
    { lsn: 1, label: 'T2 X=20', kind: 'update', durable: true },
    { lsn: 2, label: 'T2 Y=40', kind: 'update', durable: true },
  ];
  const clr3: Rec = { lsn: 3, label: 'CLR Y=0', kind: 'clr', undoNext: 1, durable: false };
  const clr4: Rec = { lsn: 4, label: 'CLR X=0', kind: 'clr', undoNext: 0, durable: false };
  const end5: Rec = { lsn: 5, label: 'end T2', kind: 'end', durable: false };

  const f: Frame[] = [];

  f.push({
    phase: 'start',
    recs: [...base],
    activeLSN: null,
    x: 20,
    y: 40,
    cursor: 'undo T2 from its newest change (LSN 2)',
    note: 'Loser T2 made two changes, both now on disk (X=20, Y=40). Undo must reverse both, newest first, along T2’s prevLSN chain 2 → 1.',
  });

  f.push({
    phase: 'undo',
    recs: [...base, { ...clr3, durable: true }],
    activeLSN: 2,
    x: 20,
    y: 0,
    yTag: 'undone',
    cursor: 'CLR 3 written · undoNext = 1',
    note: 'Undo LSN 2: reverse Y to 0 and log CLR 3, which records the reversal and points undoNext = 1 (the next change still to undo).',
  });

  f.push({
    phase: 'crash',
    recs: [...base, { ...clr3, durable: true }],
    activeLSN: null,
    x: 20,
    y: 0,
    cursor: 'in-memory undo progress LOST',
    note: '*** A second crash — during recovery. Only the durable log survives: changes 1, 2 and CLR 3. The fact that undo had reached LSN 1 is gone from memory. Naively, undo would restart and reverse Y a SECOND time — corrupting it.',
  });

  f.push({
    phase: 'redo',
    recs: [...base, { ...clr3, durable: true }],
    activeLSN: 3,
    x: 20,
    y: 0,
    yTag: 'redone',
    cursor: 'CLR 3 redone, not re-undone',
    note: 'Restart. Redo replays the log — including CLR 3. A CLR is redo-only: it is REDONE (Y stays 0 via the pageLSN check), never undone. The rollback work already done is preserved for free.',
  });

  f.push({
    phase: 'resume',
    recs: [...base, { ...clr3, durable: true }, { ...clr4, durable: true }, { ...end5, durable: true }],
    activeLSN: 1,
    x: 0,
    y: 0,
    xTag: 'undone',
    cursor: 'resumed at undoNext = 1',
    note: 'Undo resumes — not from the top, but from CLR 3’s undoNext = 1. It reverses X to 0, logs CLR 4 (undoNext = 0 → chain done), and writes T2’s end record.',
  });

  f.push({
    phase: 'done',
    recs: [...base, { ...clr3, durable: true }, { ...clr4, durable: true }, { ...end5, durable: true }],
    activeLSN: null,
    x: 0,
    y: 0,
    cursor: 'each change undone exactly once',
    note: 'Done. Both changes reversed, each exactly once, across a crash that struck mid-undo. CLRs + undoNextLSN make recovery itself idempotent and restartable.',
  });

  return f;
}

function phaseColor(p: Frame['phase']): string {
  if (p === 'crash') return RED;
  if (p === 'redo') return GREEN;
  if (p === 'undo' || p === 'resume') return ORANGE;
  if (p === 'done') return GREEN;
  return MUTED;
}

function Cell({ name, val, tag }: { name: string; val: number | null; tag?: string | null }) {
  const tagColor = tag === 'undone' ? ORANGE : tag === 'redone' ? GREEN : MUTED;
  return (
    <motion.div
      layout
      className="rounded-md px-3 py-2 font-mono"
      style={{ background: 'var(--color-fig-bg)', border: `1.5px solid ${tag ? tagColor : 'rgba(0,0,0,0.14)'}`, minWidth: 90 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span style={{ fontWeight: 700, color: 'var(--color-fig-fg)' }}>page {name}</span>
      </div>
      <div className="text-[16px] font-bold" style={{ color: val === 0 ? MUTED : 'var(--color-fig-fg)' }}>
        {val}
      </div>
      {tag && (
        <div className="text-[10px] font-semibold" style={{ color: tagColor }}>
          {tag}
        </div>
      )}
    </motion.div>
  );
}

export default function CLRScene() {
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
    const delay = 1200 - speed * 150;
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
      number="11.4"
      caption="Why recovery survives a crash during recovery. Undo logs a compensation record (CLR) for each change it reverses; a CLR is redo-only and carries an undoNextLSN. When a second crash strikes mid-undo, Redo replays the CLRs already written (redone, never re-undone) and Undo resumes from the last undoNextLSN — so each change is undone exactly once. On a narrow screen the log scrolls and the panels stack."
    >
      <div className="space-y-4">
        {/* phase pill */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] font-semibold font-sans"
            style={{
              background: 'var(--color-fig-bg)',
              border: `1px solid ${phaseColor(frame.phase)}`,
              color: phaseColor(frame.phase),
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: phaseColor(frame.phase), display: 'inline-block' }} />
            {frame.phase === 'crash' ? 'crash during recovery' : frame.phase}
          </span>
          <span className="font-mono text-[11px]" style={{ color: MUTED }}>
            {frame.cursor}
          </span>
          <span className="font-mono tabular-nums text-[11px]" style={{ color: MUTED }}>
            step {Math.min(idx + 1, frames.length)}/{frames.length}
          </span>
        </div>

        {/* log */}
        <div className="fig-card" style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
          <div className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            log (durable)
          </div>
          <div className="flex gap-1.5" style={{ minWidth: 'min-content' }}>
            {frame.recs.map((r) => {
              const active = frame.activeLSN === r.lsn;
              const c = r.kind === 'clr' ? ORANGE : r.kind === 'end' ? 'var(--color-fig-blue)' : 'var(--color-fig-fg)';
              return (
                <motion.div
                  key={r.lsn}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0, scale: active ? 1.06 : 1 }}
                  className="rounded px-2 py-1 text-center font-mono"
                  style={{
                    minWidth: 64,
                    background: active ? `${phaseColor(frame.phase)}1f` : 'var(--color-fig-bg)',
                    border: `1.5px solid ${active ? phaseColor(frame.phase) : 'rgba(0,0,0,0.14)'}`,
                    color: c,
                  }}
                >
                  <div className="text-[11px] font-bold">#{r.lsn}</div>
                  <div className="text-[10px] leading-tight" style={{ color: MUTED }}>
                    {r.label}
                  </div>
                  {r.kind === 'clr' && (
                    <div className="text-[9px] font-bold" style={{ color: ORANGE }}>
                      undoNext {r.undoNext}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* pages */}
        <div className="flex flex-wrap gap-2">
          <Cell name="X" val={frame.x} tag={frame.xTag} />
          <Cell name="Y" val={frame.y} tag={frame.yTag} />
        </div>

        {/* note */}
        <div
          className="font-sans text-[12.5px] leading-snug rounded-md px-3 py-2"
          role="status"
          aria-live="polite"
          style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.08)', color: 'var(--color-fig-fg)', minHeight: 58 }}
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
        <div className="space-y-1 pt-0.5">
          <Slider label="speed" min={1} max={5} step={1} value={speed} onChange={setSpeed} />
        </div>
      </div>
    </Figure>
  );
}
