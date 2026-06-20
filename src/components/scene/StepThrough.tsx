import React, { useState, type ReactNode } from 'react';

export interface Step {
  label: string;
  content: ReactNode;
}

interface Props {
  steps: Step[];
  initial?: number;
  onStepChange?: (i: number) => void;
}

export function StepThrough({ steps, initial = 0, onStepChange }: Props) {
  const [i, setI] = useState(Math.min(Math.max(initial, 0), steps.length - 1));

  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), steps.length - 1);
    setI(clamped);
    onStepChange?.(clamped);
  };

  return (
    <div className="font-sans text-[color:var(--color-fig-fg)]">
      <div className="mb-3">{steps[i].content}</div>
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => go(i - 1)}
          className="px-2 py-1 rounded bg-[color:var(--color-fig-muted)]/20 hover:bg-[color:var(--color-fig-muted)]/40 disabled:opacity-40"
          disabled={i === 0}
          aria-label="Previous step"
        >Prev</button>
        <input
          type="range"
          min={0}
          max={steps.length - 1}
          value={i}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="Step scrubber"
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => go(i + 1)}
          className="px-2 py-1 rounded bg-[color:var(--color-fig-muted)]/20 hover:bg-[color:var(--color-fig-muted)]/40 disabled:opacity-40"
          disabled={i === steps.length - 1}
          aria-label="Next step"
        >Next</button>
        <span className="text-[color:var(--color-fig-muted)] tabular-nums w-12 text-right">
          {i + 1} / {steps.length}
        </span>
      </div>
    </div>
  );
}
