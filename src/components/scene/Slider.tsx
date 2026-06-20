import React from 'react';

interface Props {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}

export function Slider({ label, min, max, step = 1, value, onChange }: Props) {
  return (
    <label className="inline-flex items-center gap-2 font-sans text-xs text-[color:var(--color-fig-fg)] w-full">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        aria-label={label}
      />
      <span className="tabular-nums w-10 text-right text-[color:var(--color-fig-muted)]">{value}</span>
    </label>
  );
}
