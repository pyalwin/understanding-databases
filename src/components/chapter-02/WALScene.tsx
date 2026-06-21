import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Figure, Slider } from '@/components/scene';

/*
 * WALScene — chapter 02 hero scene.
 *
 * The reader walks a 4-step commit:
 *   1. append the intent record to the log
 *   2. fsync the log (durability barrier)
 *   3. apply the change to the data files (a.json, b.json)
 *   4. ack the user
 *
 * The crash slider snaps to one of five positions: 0..4. The value is
 * "how many steps completed before the crash." Position 4 means the
 * transaction ran end-to-end and the user was acknowledged.
 *
 * Transfer: move $50 from Alice ($100) to Bob ($50).
 */

const TRANSFER = {
  from: 'a',
  to: 'b',
  amt: 50,
  fromName: 'Alice',
  toName: 'Bob',
} as const;

const INITIAL = { a: 100, b: 50 } as const;
const FINAL = { a: INITIAL.a - TRANSFER.amt, b: INITIAL.b + TRANSFER.amt } as const;

const LOG_RECORD = `{"op":"transfer","from":"a","to":"b","amt":50}`;

type Position = 0 | 1 | 2 | 3 | 4;

interface Step {
  id: 1 | 2 | 3 | 4;
  key: 'append' | 'fsync' | 'apply' | 'ack';
  label: string;
  blurb: string;
}

const STEPS: readonly Step[] = [
  { id: 1, key: 'append', label: 'append',    blurb: 'write intent to log' },
  { id: 2, key: 'fsync',  label: 'fsync',     blurb: 'durability barrier' },
  { id: 3, key: 'apply',  label: 'apply',     blurb: 'update data files' },
  { id: 4, key: 'ack',    label: 'ack',       blurb: 'tell the user OK' },
] as const;

interface Interpretation {
  text: string;
  tone: 'safe' | 'ambiguous' | 'corrupt' | 'committed';
  heading: string;
}

const INTERPRETATIONS: Record<Position, Interpretation> = {
  0: {
    heading: 'crash before append',
    tone: 'safe',
    text: 'log empty: nothing happened, nothing to recover',
  },
  1: {
    heading: 'crash after append, before fsync',
    tone: 'ambiguous',
    text: 'log appended but not fsynced — the OS may have lost it, treat as not-committed',
  },
  2: {
    heading: 'crash after fsync, before apply',
    tone: 'corrupt',
    text: 'log fsynced, apply incomplete — this is what recovery is for',
  },
  3: {
    heading: 'crash after apply, before ack',
    tone: 'ambiguous',
    text: 'apply done, ack lost — the user thinks it failed, but the database knows it succeeded',
  },
  4: {
    heading: 'no crash',
    tone: 'committed',
    text: 'committed and acknowledged',
  },
};

function toneColor(tone: Interpretation['tone']): string {
  switch (tone) {
    case 'safe':       return 'var(--color-fig-green)';
    case 'ambiguous':  return 'var(--color-accent)';
    case 'corrupt':    return 'var(--color-fig-red)';
    case 'committed':  return 'var(--color-fig-green)';
  }
}

function toneBg(tone: Interpretation['tone']): string {
  switch (tone) {
    case 'safe':       return 'rgba(47, 107, 58, 0.10)';
    case 'ambiguous':  return 'rgba(180, 83, 9, 0.10)';
    case 'corrupt':    return 'rgba(169, 30, 30, 0.10)';
    case 'committed':  return 'rgba(47, 107, 58, 0.10)';
  }
}

function toneBorder(tone: Interpretation['tone']): string {
  switch (tone) {
    case 'safe':       return 'rgba(47, 107, 58, 0.40)';
    case 'ambiguous':  return 'rgba(180, 83, 9, 0.40)';
    case 'corrupt':    return 'rgba(169, 30, 30, 0.40)';
    case 'committed':  return 'rgba(47, 107, 58, 0.40)';
  }
}

interface DerivedState {
  logHasRecord: boolean;
  logFsynced: boolean;
  applied: boolean;
  acked: boolean;
  // For each step (1..4): 'done' | 'crashed-here' | 'pending'
  stepStatus: Record<1 | 2 | 3 | 4, 'done' | 'pending'>;
}

function derive(pos: Position): DerivedState {
  return {
    logHasRecord: pos >= 1,
    logFsynced:   pos >= 2,
    applied:      pos >= 3,
    acked:        pos >= 4,
    stepStatus: {
      1: pos >= 1 ? 'done' : 'pending',
      2: pos >= 2 ? 'done' : 'pending',
      3: pos >= 3 ? 'done' : 'pending',
      4: pos >= 4 ? 'done' : 'pending',
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

interface StepPillProps {
  step: Step;
  done: boolean;
  isCrashBoundary: boolean;
  crashed: boolean;
}

function StepPill({ step, done, isCrashBoundary, crashed }: StepPillProps) {
  const accent = done ? 'var(--color-accent)' : 'rgba(0,0,0,0.10)';
  const bg = done ? 'rgba(180, 83, 9, 0.10)' : 'transparent';
  const fg = done ? 'var(--color-accent)' : 'var(--color-fig-muted)';
  return (
    <div
      className="flex flex-col items-start gap-1 rounded-md px-3 py-2 transition-colors"
      style={{
        background: bg,
        border: `1px solid ${accent}`,
        color: fg,
        minWidth: 0,
      }}
    >
      <div className="flex items-center gap-2 font-sans text-[10px] uppercase tracking-[0.12em] font-semibold">
        <span
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: 18,
            height: 18,
            background: done ? 'var(--color-accent)' : 'transparent',
            color: done ? '#fff' : 'var(--color-fig-muted)',
            border: `1px solid ${done ? 'var(--color-accent)' : 'rgba(0,0,0,0.20)'}`,
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          {step.id}
        </span>
        <span>{step.label}</span>
      </div>
      <div className="font-sans text-[11px] leading-snug" style={{ color: 'var(--color-fig-muted)' }}>
        {step.blurb}
      </div>
      {isCrashBoundary && crashed && (
        <div
          className="font-sans text-[10px] uppercase tracking-wider font-semibold mt-1"
          style={{ color: 'var(--color-fig-red)' }}
        >
          ← crashed here
        </div>
      )}
    </div>
  );
}

interface HorizontalTimelineProps {
  state: DerivedState;
  position: Position;
}

function HorizontalTimeline({ state, position }: HorizontalTimelineProps) {
  // crash boundary is between step N and step N+1, i.e. after step `position`.
  // Show "crashed here" badge next to the last completed step when position < 4.
  return (
    <div className="hidden sm:flex items-stretch gap-2">
      {STEPS.map((s, i) => (
        <React.Fragment key={s.key}>
          <div className="flex-1 min-w-0">
            <StepPill
              step={s}
              done={state.stepStatus[s.id] === 'done'}
              isCrashBoundary={position < 4 && position === s.id}
              crashed={position < 4}
            />
          </div>
          {i < STEPS.length - 1 && (
            <div
              aria-hidden
              className="self-center font-sans text-base shrink-0"
              style={{
                color: state.stepStatus[STEPS[i + 1].id] === 'done'
                  ? 'var(--color-accent)'
                  : 'rgba(0,0,0,0.25)',
              }}
            >
              →
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

interface VerticalRailProps {
  state: DerivedState;
  position: Position;
}

function VerticalRail({ state, position }: VerticalRailProps) {
  return (
    <ol className="sm:hidden relative pl-7 m-0 list-none">
      {/* the rail itself */}
      <div
        aria-hidden
        className="absolute left-[10px] top-2 bottom-2 w-px"
        style={{ background: 'rgba(0,0,0,0.15)' }}
      />
      {STEPS.map((s) => {
        const done = state.stepStatus[s.id] === 'done';
        const crashedHere = position < 4 && position === s.id;
        return (
          <li key={s.key} className="relative pb-3 last:pb-0">
            {/* dot on the rail */}
            <span
              aria-hidden
              className="absolute left-[3px] top-[6px] rounded-full"
              style={{
                width: 14,
                height: 14,
                background: done ? 'var(--color-accent)' : 'var(--color-fig-bg)',
                border: `2px solid ${done ? 'var(--color-accent)' : 'rgba(0,0,0,0.25)'}`,
                boxShadow: done ? '0 0 0 3px rgba(180, 83, 9, 0.15)' : 'none',
              }}
            />
            <div className="flex flex-col gap-0.5">
              <div
                className="flex items-baseline gap-2 font-sans text-[11px] uppercase tracking-[0.12em] font-semibold"
                style={{ color: done ? 'var(--color-accent)' : 'var(--color-fig-muted)' }}
              >
                <span>step {s.id}</span>
                <span>·</span>
                <span>{s.label}</span>
              </div>
              <div
                className="font-sans text-[12px] leading-snug"
                style={{ color: 'var(--color-fig-muted)' }}
              >
                {s.blurb}
              </div>
              {crashedHere && (
                <div
                  className="font-sans text-[10px] uppercase tracking-wider font-semibold mt-0.5"
                  style={{ color: 'var(--color-fig-red)' }}
                >
                  ↓ crashed after this step
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface LogCardProps {
  state: DerivedState;
}

function LogCard({ state }: LogCardProps) {
  return (
    <div className="fig-card p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="font-mono text-[12px] text-[color:var(--color-fig-fg)]">
          log
        </div>
        <div className="font-sans text-[10px] uppercase tracking-wider text-[color:var(--color-fig-muted)]">
          append-only
        </div>
      </div>
      {state.logHasRecord ? (
        <div className="flex items-start gap-2">
          <span
            aria-hidden
            className="font-mono text-[11px] shrink-0"
            style={{ color: 'var(--color-fig-muted)' }}
          >
            1
          </span>
          <pre
            className="font-mono text-[12.5px] whitespace-pre-wrap break-all m-0 flex-1 min-w-0"
            style={{
              color: state.logFsynced
                ? 'var(--color-fig-green)'
                : 'var(--color-accent)',
            }}
          >
            {LOG_RECORD}
          </pre>
          <span
            className="shrink-0 font-sans text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
            style={{
              color: state.logFsynced
                ? 'var(--color-fig-green)'
                : 'var(--color-accent)',
              background: state.logFsynced
                ? 'rgba(47, 107, 58, 0.12)'
                : 'rgba(180, 83, 9, 0.12)',
              border: `1px solid ${
                state.logFsynced
                  ? 'rgba(47, 107, 58, 0.35)'
                  : 'rgba(180, 83, 9, 0.35)'
              }`,
            }}
          >
            {state.logFsynced ? 'fsynced' : 'in page cache'}
          </span>
        </div>
      ) : (
        <div className="font-sans text-[11px] italic text-[color:var(--color-fig-muted)] py-2">
          (empty)
        </div>
      )}
    </div>
  );
}

interface DataFileProps {
  name: string;
  who: string;
  initial: number;
  current: number;
  changed: boolean;
}

function DataFileCard({ name, who, initial, current, changed }: DataFileProps) {
  return (
    <div className="fig-card p-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="font-mono text-[12px] text-[color:var(--color-fig-fg)]">
          {name}
        </div>
        <div className="font-sans text-[10px] uppercase tracking-wider text-[color:var(--color-fig-muted)]">
          {who}
        </div>
      </div>
      <pre
        className="font-mono text-[12.5px] whitespace-pre-wrap break-all m-0"
        style={{
          color: changed ? 'var(--color-fig-green)' : 'var(--color-fig-fg)',
        }}
      >
{`{"balance": ${current}}`}
      </pre>
      <div
        className="font-sans text-[11px] mt-1.5"
        style={{ color: 'var(--color-fig-muted)' }}
      >
        {changed
          ? `was $${initial} · now $${current}`
          : `still $${initial}`}
      </div>
    </div>
  );
}

interface StatusBoxProps {
  interp: Interpretation;
}

function StatusBox({ interp }: StatusBoxProps) {
  const color = toneColor(interp.tone);
  return (
    <div
      className="rounded-md p-3"
      style={{
        background: toneBg(interp.tone),
        border: `1px solid ${toneBorder(interp.tone)}`,
      }}
      role="status"
      aria-live="polite"
    >
      <div
        className="font-sans text-[10px] uppercase tracking-[0.12em] font-semibold mb-1"
        style={{ color }}
      >
        {interp.heading}
      </div>
      <div
        className="font-sans text-[13px] leading-snug"
        style={{ color: 'var(--color-fig-fg)' }}
      >
        {interp.text}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const SLIDER_LABELS: Record<Position, string> = {
  0: 'before any step',
  1: 'after append',
  2: 'after fsync',
  3: 'after apply',
  4: 'no crash',
};

const PLAY_INTERVAL_MS = 850;

export default function WALScene() {
  const [position, setPosition] = useState<Position>(4);
  const [playing, setPlaying] = useState(false);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // play-through: advance from 0 to 4
  useEffect(() => {
    if (!playing) return;
    playTimerRef.current = setInterval(() => {
      setPosition((p) => {
        if (p >= 4) {
          if (playTimerRef.current) clearInterval(playTimerRef.current);
          setPlaying(false);
          return 4;
        }
        return (p + 1) as Position;
      });
    }, PLAY_INTERVAL_MS);
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [playing]);

  const state = useMemo(() => derive(position), [position]);
  const interp = INTERPRETATIONS[position];

  const reset = () => {
    setPlaying(false);
    setPosition(4);
  };

  const play = () => {
    if (playing) return;
    setPosition(0);
    setPlaying(true);
  };

  const aliceBalance = state.applied ? FINAL.a : INITIAL.a;
  const bobBalance = state.applied ? FINAL.b : INITIAL.b;

  return (
    <Figure
      number="2.3"
      caption="The write-ahead log. Drag the crash slider to see what state the log and data files are in."
    >
      <div className="space-y-4">
        {/* timeline */}
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-2 font-semibold">
            commit flow · transfer $50 from Alice to Bob
          </div>
          <HorizontalTimeline state={state} position={position} />
          <VerticalRail state={state} position={position} />
        </div>

        {/* log + data files */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <LogCard state={state} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <DataFileCard
              name="a.json"
              who={TRANSFER.fromName}
              initial={INITIAL.a}
              current={aliceBalance}
              changed={state.applied}
            />
            <DataFileCard
              name="b.json"
              who={TRANSFER.toName}
              initial={INITIAL.b}
              current={bobBalance}
              changed={state.applied}
            />
          </div>
        </div>

        {/* status interpretation */}
        <StatusBox interp={interp} />

        {/* ack line — small visual tell that the user heard back */}
        <div
          className="font-sans text-[11px]"
          style={{
            color: state.acked
              ? 'var(--color-fig-green)'
              : 'var(--color-fig-muted)',
          }}
        >
          user-visible response:{' '}
          {state.acked ? (
            <span className="font-semibold">200 OK · transfer committed</span>
          ) : (
            <span className="italic">— no response delivered —</span>
          )}
        </div>

        {/* slider */}
        <div className="space-y-1.5">
          <Slider
            label="crash after step"
            min={0}
            max={4}
            step={1}
            value={position}
            onChange={(v) => {
              if (playing) setPlaying(false);
              setPosition(Math.max(0, Math.min(4, v)) as Position);
            }}
          />
          <div
            className="font-sans text-[11px] text-right"
            style={{ color: 'var(--color-fig-muted)' }}
          >
            {SLIDER_LABELS[position]}
          </div>
        </div>

        {/* controls */}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={play}
            disabled={playing}
            className="fig-btn fig-btn-primary"
          >
            ▶ Play
          </button>
          <button type="button" onClick={reset} className="fig-btn">
            ⏮ Reset
          </button>
        </div>
      </div>
    </Figure>
  );
}
