import React from 'react';
import { useMemo, useState } from 'react';
import { Figure, Slider } from '@/components/scene';

/*
 * TimelineScene — chapter 03 reusable anomaly visualizer.
 *
 * Two transactions (T1, T2) on a shared database. The reader drags a
 * "now" slider to scrub through an ordered list of ops; each op is a
 * pill on its transaction's track. At each position we also derive a
 * "shared database state" card: the most recent committed write before
 * the cursor, plus a note if either transaction has uncommitted writes
 * pending.
 *
 * The per-op `effect` is what makes the anomaly legible — it's the
 * one-line annotation that turns a list of operations into a story.
 */

export type OpType = 'read' | 'write' | 'begin' | 'commit' | 'rollback';

export interface Op {
  t: 1 | 2;
  type: OpType;
  label: string;
  detail?: string;
  effect?: string;
}

interface Props {
  title?: string;
  ops?: Op[];
  caption?: string;
  number?: string;
  initialNow?: number;
  startCollapsed?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Default demo — dirty read                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_OPS: Op[] = [
  { t: 1, type: 'begin',  label: 'BEGIN' },
  { t: 1, type: 'write',  label: 'UPDATE balance = 110', detail: 'was 100',  effect: 'balance = 110 (uncommitted by T1)' },
  { t: 2, type: 'begin',  label: 'BEGIN' },
  { t: 2, type: 'read',   label: 'SELECT balance',       detail: 'reads 110', effect: 'T2 sees T1’s uncommitted write' },
  { t: 1, type: 'rollback', label: 'ROLLBACK',                              effect: 'balance reverts to 100 — but T2 already acted on 110' },
  { t: 2, type: 'commit', label: 'COMMIT',                                  effect: 'T2 commits a decision based on a value that never existed' },
];

const DEFAULT_TITLE = 'Dirty read';
const DEFAULT_CAPTION =
  'Two transactions on a shared row. T2 reads a value T1 hasn’t committed; T1 then rolls back. Drag the now-cursor to find the moment the anomaly becomes inevitable.';
const DEFAULT_NUMBER = '3.1';

/* ------------------------------------------------------------------ */
/*  Derivation                                                         */
/* ------------------------------------------------------------------ */

interface DerivedState {
  committedEffect: string | null;       // effect text of the most recent committed write
  committedAt: number | null;           // index of that op
  t1Uncommitted: boolean;
  t2Uncommitted: boolean;
  t1Status: 'idle' | 'active' | 'committed' | 'rolledback';
  t2Status: 'idle' | 'active' | 'committed' | 'rolledback';
  lastEffect: string | null;            // effect of the most recent op (any kind), to show "what just happened"
  lastEffectAt: number | null;
}

function deriveState(ops: Op[], now: number): DerivedState {
  // now is the count of ops that have happened; ops[0..now-1] are in the past.
  let t1Status: DerivedState['t1Status'] = 'idle';
  let t2Status: DerivedState['t2Status'] = 'idle';
  let t1HasWrite = false;
  let t2HasWrite = false;
  let committedEffect: string | null = null;
  let committedAt: number | null = null;
  let lastEffect: string | null = null;
  let lastEffectAt: number | null = null;

  for (let i = 0; i < Math.min(now, ops.length); i++) {
    const op = ops[i];
    if (op.effect) {
      lastEffect = op.effect;
      lastEffectAt = i;
    }
    if (op.t === 1) {
      if (op.type === 'begin') t1Status = 'active';
      else if (op.type === 'write') t1HasWrite = true;
      else if (op.type === 'commit') {
        t1Status = 'committed';
        if (t1HasWrite && op.effect) { committedEffect = op.effect; committedAt = i; }
        // If commit itself has no effect, fall back to last write effect from T1.
        if (t1HasWrite && !op.effect) {
          for (let j = i - 1; j >= 0; j--) {
            if (ops[j].t === 1 && ops[j].type === 'write' && ops[j].effect) {
              committedEffect = ops[j].effect!;
              committedAt = j;
              break;
            }
          }
        }
        t1HasWrite = false;
      } else if (op.type === 'rollback') {
        t1Status = 'rolledback';
        t1HasWrite = false;
      }
    } else {
      if (op.type === 'begin') t2Status = 'active';
      else if (op.type === 'write') t2HasWrite = true;
      else if (op.type === 'commit') {
        t2Status = 'committed';
        if (t2HasWrite && op.effect) { committedEffect = op.effect; committedAt = i; }
        if (t2HasWrite && !op.effect) {
          for (let j = i - 1; j >= 0; j--) {
            if (ops[j].t === 2 && ops[j].type === 'write' && ops[j].effect) {
              committedEffect = ops[j].effect!;
              committedAt = j;
              break;
            }
          }
        }
        t2HasWrite = false;
      } else if (op.type === 'rollback') {
        t2Status = 'rolledback';
        t2HasWrite = false;
      }
    }
  }

  return {
    committedEffect,
    committedAt,
    t1Uncommitted: t1HasWrite,
    t2Uncommitted: t2HasWrite,
    t1Status,
    t2Status,
    lastEffect,
    lastEffectAt,
  };
}

/* ------------------------------------------------------------------ */
/*  Visual atoms                                                        */
/* ------------------------------------------------------------------ */

function opColors(type: OpType): { fg: string; border: string; bg: string } {
  switch (type) {
    case 'read':
      return {
        fg: 'var(--color-fig-blue)',
        border: 'rgba(30, 79, 165, 0.45)',
        bg: 'rgba(30, 79, 165, 0.06)',
      };
    case 'write':
      return {
        fg: 'var(--color-fig-orange)',
        border: 'rgba(176, 74, 20, 0.50)',
        bg: 'rgba(176, 74, 20, 0.08)',
      };
    case 'begin':
      return {
        fg: 'var(--color-fig-green)',
        border: 'rgba(47, 107, 58, 0.50)',
        bg: 'rgba(47, 107, 58, 0.10)',
      };
    case 'commit':
      return {
        fg: 'var(--color-fig-green)',
        border: 'rgba(47, 107, 58, 0.55)',
        bg: 'rgba(47, 107, 58, 0.14)',
      };
    case 'rollback':
      return {
        fg: 'var(--color-fig-red)',
        border: 'rgba(169, 30, 30, 0.50)',
        bg: 'rgba(169, 30, 30, 0.10)',
      };
  }
}

interface OpPillProps {
  op: Op;
  index: number;
  past: boolean;
  isCurrent: boolean;
}

function OpPill({ op, index, past, isCurrent }: OpPillProps) {
  const c = opColors(op.type);
  const dim = !past;
  const isMarker = op.type === 'begin' || op.type === 'commit' || op.type === 'rollback';

  return (
    <div
      className="flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 transition-opacity"
      style={{
        background: dim ? 'transparent' : c.bg,
        border: `1px solid ${dim ? 'rgba(0,0,0,0.10)' : c.border}`,
        color: dim ? 'var(--color-fig-muted)' : c.fg,
        opacity: dim ? 0.45 : 1,
        minWidth: isMarker ? 0 : 110,
        boxShadow: isCurrent && past ? `0 0 0 2px ${c.border}` : 'none',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="font-sans text-[9px] tabular-nums leading-none"
          style={{ color: 'var(--color-fig-muted)' }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <span
          className={
            'font-mono text-[11px] leading-tight ' +
            (op.type === 'write' ? 'font-bold' : 'font-medium')
          }
        >
          {op.label}
        </span>
      </div>
      {op.detail && (
        <div
          className="font-sans text-[10.5px] leading-snug"
          style={{ color: dim ? 'var(--color-fig-muted)' : c.fg, opacity: dim ? 1 : 0.75 }}
        >
          {op.detail}
        </div>
      )}
    </div>
  );
}

interface TrackProps {
  which: 1 | 2;
  ops: Op[];
  now: number;
}

function Track({ which, ops, now }: TrackProps) {
  const accent = which === 1 ? 'var(--color-fig-blue)' : 'var(--color-fig-orange)';
  const label = which === 1 ? 'T1' : 'T2';

  // Build a row that spans all ops (full width), but only the ones for THIS
  // transaction render as pills; the others render as gap placeholders so the
  // columns stay aligned across tracks.
  return (
    <div className="flex items-stretch gap-2">
      <div
        className="shrink-0 w-9 sm:w-11 flex items-center justify-center rounded-md font-sans text-[11px] uppercase tracking-[0.12em] font-semibold"
        style={{
          color: accent,
          background: 'rgba(0,0,0,0.025)',
          border: '1px solid rgba(0,0,0,0.08)',
        }}
        aria-label={`transaction ${which}`}
      >
        {label}
      </div>
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex items-stretch gap-1.5 min-w-min">
          {ops.map((op, i) => {
            const past = i < now;
            const isCurrent = i === now - 1;
            if (op.t !== which) {
              // Spacer in the other lane — keeps column alignment.
              return (
                <div
                  key={i}
                  aria-hidden
                  className="shrink-0"
                  style={{ width: 36, minHeight: 32 }}
                />
              );
            }
            return (
              <div key={i} className="shrink-0">
                <OpPill op={op} index={i} past={past} isCurrent={isCurrent} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  status: DerivedState['t1Status'];
}

function statusText(s: DerivedState['t1Status']): { label: string; color: string; bg: string } {
  switch (s) {
    case 'idle':
      return { label: 'not started', color: 'var(--color-fig-muted)', bg: 'rgba(0,0,0,0.04)' };
    case 'active':
      return { label: 'in progress', color: 'var(--color-fig-blue)', bg: 'rgba(30, 79, 165, 0.10)' };
    case 'committed':
      return { label: 'committed', color: 'var(--color-fig-green)', bg: 'rgba(47, 107, 58, 0.12)' };
    case 'rolledback':
      return { label: 'rolled back', color: 'var(--color-fig-red)', bg: 'rgba(169, 30, 30, 0.12)' };
  }
}

function StatusBadge({ status }: StatusBadgeProps) {
  const s = statusText(status);
  return (
    <span
      className="font-sans text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

export default function TimelineScene({
  title,
  ops,
  caption,
  number,
  initialNow,
  startCollapsed = false,
}: Props) {
  const usingDefault = !ops || ops.length === 0;
  const effectiveOps = usingDefault ? DEFAULT_OPS : ops!;
  const effectiveTitle = title ?? (usingDefault ? DEFAULT_TITLE : undefined);
  const effectiveCaption = caption ?? (usingDefault ? DEFAULT_CAPTION : 'Scrub the now-cursor to step through two concurrent transactions.');
  const effectiveNumber = number ?? (usingDefault ? DEFAULT_NUMBER : undefined);

  const defaultNow = startCollapsed
    ? 0
    : initialNow !== undefined
      ? Math.max(0, Math.min(effectiveOps.length, initialNow))
      : effectiveOps.length;

  const [now, setNow] = useState<number>(defaultNow);

  const state = useMemo(() => deriveState(effectiveOps, now), [effectiveOps, now]);

  const sharedStateLine = state.committedEffect
    ? state.committedEffect
    : 'no committed writes yet';

  return (
    <Figure number={effectiveNumber} caption={effectiveCaption}>
      <div className="space-y-4">
        {/* title */}
        {effectiveTitle && (
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] font-semibold">
            {effectiveTitle}
          </div>
        )}

        {/* tracks */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] font-semibold">
              T1
            </div>
            <StatusBadge status={state.t1Status} />
          </div>
          <Track which={1} ops={effectiveOps} now={now} />
          <div className="flex items-baseline justify-between gap-2 pt-1">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] font-semibold">
              T2
            </div>
            <StatusBadge status={state.t2Status} />
          </div>
          <Track which={2} ops={effectiveOps} now={now} />
        </div>

        {/* shared db state card */}
        <div className="fig-card p-3">
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] font-semibold">
              shared database state
            </div>
            <div className="font-sans text-[10px] tabular-nums text-[color:var(--color-fig-muted)]">
              t = {now} / {effectiveOps.length}
            </div>
          </div>
          <div
            className="font-mono text-[13px] leading-snug"
            style={{
              color: state.committedEffect
                ? 'var(--color-fig-green)'
                : 'var(--color-fig-muted)',
            }}
          >
            {sharedStateLine}
          </div>
          {(state.t1Uncommitted || state.t2Uncommitted) && (
            <div
              className="font-sans text-[11px] mt-2 leading-snug"
              style={{ color: 'var(--color-fig-orange)' }}
            >
              uncommitted writes pending:
              {state.t1Uncommitted && ' T1'}
              {state.t1Uncommitted && state.t2Uncommitted && ' and'}
              {state.t2Uncommitted && ' T2'}
            </div>
          )}
          {state.lastEffect && state.lastEffectAt === now - 1 && (
            <div
              className="font-sans text-[11px] italic mt-2 leading-snug"
              style={{ color: 'var(--color-fig-fg)', opacity: 0.75 }}
            >
              just happened: {state.lastEffect}
            </div>
          )}
        </div>

        {/* slider */}
        <div className="space-y-1.5">
          <Slider
            label="now"
            min={0}
            max={effectiveOps.length}
            step={1}
            value={now}
            onChange={(v) => setNow(Math.max(0, Math.min(effectiveOps.length, v)))}
          />
          <div
            className="font-sans text-[11px] text-right"
            style={{ color: 'var(--color-fig-muted)' }}
          >
            {now === 0
              ? 'before anything happens'
              : now >= effectiveOps.length
                ? 'all ops complete'
                : `after op ${now} of ${effectiveOps.length}`}
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => setNow(0)}
            className="fig-btn"
          >
            ⏮ Start
          </button>
          <button
            type="button"
            onClick={() => setNow((n) => Math.max(0, n - 1))}
            className="fig-btn"
            disabled={now === 0}
          >
            ◀ Step
          </button>
          <button
            type="button"
            onClick={() => setNow((n) => Math.min(effectiveOps.length, n + 1))}
            className="fig-btn"
            disabled={now >= effectiveOps.length}
          >
            Step ▶
          </button>
          <button
            type="button"
            onClick={() => setNow(effectiveOps.length)}
            className="fig-btn"
          >
            End ⏭
          </button>
        </div>
      </div>
    </Figure>
  );
}
