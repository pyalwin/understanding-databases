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
      <div className="mb-4">{steps[i].content}</div>
      <div className="flex items-center gap-3 pt-3 border-t border-black/10">
        <button
          type="button"
          onClick={() => go(i - 1)}
          className="fig-btn"
          disabled={i === 0}
          aria-label="Previous step"
        >
          <span aria-hidden="true">←</span> Prev
        </button>
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
          className="fig-btn"
          disabled={i === steps.length - 1}
          aria-label="Next step"
        >
          Next <span aria-hidden="true">→</span>
        </button>
        <span className="text-[11px] text-[color:var(--color-fig-muted)] tabular-nums w-10 text-right">
          {i + 1} <span className="opacity-50">/</span> {steps.length}
        </span>
      </div>
    </div>
  );
}
