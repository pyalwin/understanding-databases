import React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Figure, Slider, Toggle } from '@/components/scene';

/*
 * TwoPhaseScene — chapter 08, Figure 8.2 (§3).
 *
 * The LIFETIME of one transaction's locks. We plot the number of locks the
 * transaction holds over time: it rises through the GROWING phase (acquire
 * only), peaks at the LOCK POINT (the last acquire / first release), then falls
 * through the SHRINKING phase (release only). The single rule that makes a
 * schedule serializable is the shape itself: up, then down, never up again.
 *
 * The strict-mode toggle changes the tail. Basic 2PL may release the exclusive
 * lock as soon as the work is done; STRICT 2PL holds every exclusive lock flat
 * until commit — a visible plateau — so no other transaction can read the
 * uncommitted write (cascadeless aborts).
 *
 * A second lane shows T2, which wants the same exclusive item: it must wait the
 * whole time T1 holds it. Strict 2PL makes that wait longer (until commit),
 * which is exactly how 2PL forces a serial order.
 */

type Phase = 'start' | 'growing' | 'shrinking' | 'done';

interface Frame {
  label: string;    // short op label on the axis
  detail: string;   // status-line blurb
  count: number;    // locks held AFTER this op
  phase: Phase;
  lockPoint?: boolean;
  xHeld?: boolean;  // this bar is the exclusive lock held to commit (strict)
}

const MAX_COUNT = 3;

// Basic 2PL: the exclusive lock on C is released in the shrinking phase, as
// soon as T1 is done with it — before commit.
const BASIC: readonly Frame[] = [
  { label: 'begin', detail: 'transaction begins — holds nothing', count: 0, phase: 'start' },
  { label: 'S·A', detail: 'acquire SHARED lock on A (read)', count: 1, phase: 'growing' },
  { label: 'S·B', detail: 'acquire SHARED lock on B (read)', count: 2, phase: 'growing' },
  { label: 'X·C', detail: 'acquire EXCLUSIVE lock on C (write) — the peak', count: 3, phase: 'growing', lockPoint: true },
  { label: 'rel A', detail: 'release A — first release: the shrinking phase begins', count: 2, phase: 'shrinking' },
  { label: 'rel B', detail: 'release B', count: 1, phase: 'shrinking' },
  { label: 'rel C', detail: 'release the EXCLUSIVE lock on C — early, before commit', count: 0, phase: 'shrinking' },
  { label: 'commit', detail: 'commit — but C was readable by others since the last step', count: 0, phase: 'done' },
] as const;

// Strict 2PL: shared locks may drop early, but the exclusive lock on C is held
// FLAT until commit (the plateau), then all are released at once.
const STRICT: readonly Frame[] = [
  { label: 'begin', detail: 'transaction begins — holds nothing', count: 0, phase: 'start' },
  { label: 'S·A', detail: 'acquire SHARED lock on A (read)', count: 1, phase: 'growing' },
  { label: 'S·B', detail: 'acquire SHARED lock on B (read)', count: 2, phase: 'growing' },
  { label: 'X·C', detail: 'acquire EXCLUSIVE lock on C (write) — the peak', count: 3, phase: 'growing', lockPoint: true },
  { label: 'rel A', detail: 'release shared A — shrinking phase begins', count: 2, phase: 'shrinking' },
  { label: 'rel B', detail: 'release shared B', count: 1, phase: 'shrinking' },
  { label: 'hold X', detail: 'STRICT: the exclusive lock on C is held flat — no one reads the uncommitted write', count: 1, phase: 'shrinking', xHeld: true },
  { label: 'commit', detail: 'commit — only now is the exclusive lock on C released', count: 0, phase: 'done' },
] as const;

// The frame at which the conflicting exclusive lock on C is finally released —
// when a waiting T2 can proceed. Basic: at "rel C" (index 6). Strict: not until
// "commit" (index 7).
const RELEASE_FRAME = { basic: 6, strict: 7 } as const;

function phaseColor(phase: Phase, xHeld?: boolean): string {
  if (xHeld) return 'var(--color-fig-red)';
  switch (phase) {
    case 'growing':   return 'var(--color-fig-green)';
    case 'shrinking': return 'var(--color-fig-orange)';
    case 'done':      return 'var(--color-fig-muted)';
    case 'start':     return 'var(--color-fig-muted)';
  }
}

const PLAY_INTERVAL_MS = 850;

export default function TwoPhaseScene() {
  const [strict, setStrict] = useState(true);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const frames = strict ? STRICT : BASIC;
  const releaseFrame = strict ? RELEASE_FRAME.strict : RELEASE_FRAME.basic;
  const lastStep = frames.length - 1;

  // Clamp the playhead when the schedule length changes with the toggle.
  useEffect(() => {
    setStep((s) => Math.min(s, frames.length - 1));
  }, [frames.length]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setStep((s) => {
        if (s >= lastStep) {
          if (timerRef.current) clearInterval(timerRef.current);
          setPlaying(false);
          return lastStep;
        }
        return s + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, lastStep]);

  const cur = frames[step];
  const lockPointIdx = useMemo(
    () => frames.findIndex((f) => f.lockPoint),
    [frames],
  );

  const play = () => {
    if (playing) return;
    setStep(0);
    setPlaying(true);
  };
  const reset = () => {
    setPlaying(false);
    setStep(0);
  };

  const phaseLabel =
    cur.phase === 'growing'
      ? 'GROWING — acquire only'
      : cur.phase === 'shrinking'
        ? 'SHRINKING — release only'
        : cur.phase === 'done'
          ? 'COMMITTED'
          : 'START';

  return (
    <Figure
      number="8.2"
      caption="Two-phase locking, seen as the shape of one transaction's lock lifetime: it rises through the growing phase, peaks at the lock point, then falls through the shrinking phase — never acquiring again. Toggle strict mode to hold the exclusive lock flat until commit. The lower lane shows a second transaction, which must wait for the conflicting lock the whole time T1 holds it."
    >
      <div className="space-y-4">
        {/* Phase + lock-count readout. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)]">
              locks held
            </div>
            <div className="font-mono text-3xl tabular-nums leading-none">
              {cur.count}
              <span className="text-[color:var(--color-fig-muted)] text-lg"> / {MAX_COUNT}</span>
            </div>
          </div>
          <div
            className="font-sans text-[11px] uppercase tracking-[0.12em] font-semibold px-2 py-1 rounded"
            style={{
              color: phaseColor(cur.phase, cur.xHeld),
              background:
                cur.phase === 'growing'
                  ? 'rgba(47,107,58,0.12)'
                  : cur.phase === 'shrinking'
                    ? 'rgba(176,74,20,0.12)'
                    : 'rgba(120,112,106,0.12)',
            }}
          >
            {phaseLabel}
          </div>
        </div>

        {/* The lock-count chart: one bar per step. */}
        <div>
          <div className="flex items-end gap-1" style={{ height: 132 }}>
            {frames.map((f, i) => {
              const isCur = i === step;
              const h = 8 + (f.count / MAX_COUNT) * 104;
              const color = phaseColor(f.phase, f.xHeld);
              return (
                <div key={i} className="flex-1 min-w-0 flex flex-col justify-end items-center h-full">
                  {f.lockPoint && (
                    <div
                      className="font-sans text-[8px] uppercase tracking-[0.08em] font-semibold mb-0.5 text-center leading-tight"
                      style={{ color: 'var(--color-fig-blue)' }}
                    >
                      ◆ lock<br />point
                    </div>
                  )}
                  <motion.div
                    className="w-full rounded-t"
                    initial={false}
                    animate={{ height: h, opacity: isCur ? 1 : 0.42 }}
                    transition={{ duration: 0.35 }}
                    style={{
                      background: color,
                      border: isCur ? `2px solid ${color}` : '2px solid transparent',
                      boxShadow: isCur ? `0 0 0 2px rgba(30,79,165,0.25)` : 'none',
                      minHeight: 8,
                    }}
                    title={`${f.label}: holds ${f.count}`}
                  />
                </div>
              );
            })}
          </div>
          {/* axis labels */}
          <div className="flex gap-1 mt-1">
            {frames.map((f, i) => (
              <div
                key={i}
                className="flex-1 min-w-0 font-mono text-[8.5px] text-center leading-tight"
                style={{
                  color: i === step ? phaseColor(f.phase, f.xHeld) : 'var(--color-fig-muted)',
                  fontWeight: i === step ? 700 : 400,
                }}
              >
                {f.label}
              </div>
            ))}
          </div>
        </div>

        {/* Status line for the current step. */}
        <div
          className="font-sans text-[12.5px] leading-snug min-h-[2.4em] rounded-md p-2.5"
          style={{
            background: 'rgba(0,0,0,0.03)',
            border: '1px solid rgba(0,0,0,0.08)',
            color: 'var(--color-fig-fg)',
          }}
          role="status"
          aria-live="polite"
        >
          <span className="font-mono font-semibold" style={{ color: phaseColor(cur.phase, cur.xHeld) }}>
            {cur.label}
          </span>{' '}
          — {cur.detail}
        </div>

        {/* Second transaction lane: T2 wants the same exclusive item. */}
        <div>
          <div className="font-sans text-[10px] uppercase tracking-[0.12em] text-[color:var(--color-fig-muted)] mb-1.5">
            meanwhile · T2 also wants an exclusive lock on C
          </div>
          <div className="space-y-1">
            {/* T1 lane */}
            <Lane
              name="T1"
              frames={frames}
              step={step}
              kind="t1"
              releaseFrame={releaseFrame}
              lockPointIdx={lockPointIdx}
            />
            {/* T2 lane */}
            <Lane
              name="T2"
              frames={frames}
              step={step}
              kind="t2"
              releaseFrame={releaseFrame}
              lockPointIdx={lockPointIdx}
            />
          </div>
          <div className="font-sans text-[11px] mt-1.5" style={{ color: 'var(--color-fig-muted)' }}>
            T2 stays blocked until T1 releases C{strict ? ' at commit' : ''} — 2PL forces a serial order. {strict ? 'Strict mode makes the wait longer, but T2 never sees an uncommitted value.' : 'Basic mode frees C earlier, but T2 could read a value T1 has not committed.'}
          </div>
        </div>

        {/* Controls. */}
        <div className="space-y-3 pt-1">
          <Toggle
            label="strict 2PL (hold exclusive locks to commit)"
            value={strict}
            onChange={(v) => {
              setStrict(v);
              setPlaying(false);
            }}
          />
          <Slider
            label="step"
            min={0}
            max={lastStep}
            step={1}
            value={step}
            onChange={(v) => {
              if (playing) setPlaying(false);
              setStep(Math.max(0, Math.min(lastStep, v)));
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={play} disabled={playing} className="fig-btn fig-btn-primary">
              ▶ Play
            </button>
            <button type="button" onClick={reset} className="fig-btn">
              ⏮ Reset
            </button>
          </div>
        </div>
      </div>
    </Figure>
  );
}

/* ------------------------------------------------------------------ */

interface LaneProps {
  name: string;
  frames: readonly Frame[];
  step: number;
  kind: 't1' | 't2';
  releaseFrame: number;
  lockPointIdx: number;
}

function Lane({ name, frames, step, kind, releaseFrame, lockPointIdx }: LaneProps) {
  return (
    <div className="flex items-stretch gap-1">
      <div className="w-7 shrink-0 font-mono text-[11px] flex items-center" style={{ color: 'var(--color-fig-fg)' }}>
        {name}
      </div>
      <div className="flex-1 min-w-0 flex gap-0.5">
        {frames.map((_f, i) => {
          const reached = i <= step;
          let bg = 'transparent';
          let label = '';
          let color = 'var(--color-fig-muted)';
          if (kind === 't1') {
            // T1 holds the exclusive lock on C from the lock point until release.
            if (i >= lockPointIdx && i < releaseFrame) {
              bg = reached ? 'rgba(169,30,30,0.20)' : 'rgba(169,30,30,0.07)';
              color = 'var(--color-fig-red)';
              label = i === lockPointIdx ? 'holds X·C' : '';
            } else if (i < lockPointIdx) {
              bg = reached ? 'rgba(47,107,58,0.18)' : 'rgba(47,107,58,0.06)';
            } else {
              bg = 'rgba(120,112,106,0.10)';
            }
          } else {
            // T2 is blocked until T1 releases C, then runs.
            if (i < releaseFrame) {
              bg = reached ? 'rgba(176,74,20,0.16)' : 'rgba(176,74,20,0.05)';
              color = 'var(--color-fig-orange)';
              label = i === lockPointIdx ? 'waits…' : '';
            } else {
              bg = reached ? 'rgba(47,107,58,0.22)' : 'rgba(47,107,58,0.08)';
              color = 'var(--color-fig-green)';
              label = i === releaseFrame ? 'runs' : '';
            }
          }
          return (
            <div
              key={i}
              className="flex-1 min-w-0 h-6 rounded-sm flex items-center justify-center font-sans text-[8.5px] font-semibold tracking-tight overflow-hidden whitespace-nowrap"
              style={{
                background: bg,
                color,
                border: i === step ? '1px solid rgba(30,79,165,0.45)' : '1px solid transparent',
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
