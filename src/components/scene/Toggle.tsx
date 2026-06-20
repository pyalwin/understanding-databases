import React from 'react';

interface Props {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function Toggle({ label, value, onChange }: Props) {
  return (
    <label className="inline-flex items-center gap-2 font-sans text-xs text-[color:var(--color-fig-fg)]">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={
          'relative w-9 h-5 rounded-full transition-colors ' +
          (value ? 'bg-[color:var(--color-fig-green)]' : 'bg-[color:var(--color-fig-muted)]/40')
        }
      >
        <span
          className={
            'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ' +
            (value ? 'left-[18px]' : 'left-0.5')
          }
        />
      </button>
    </label>
  );
}
