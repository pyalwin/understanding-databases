import React, { useState, type ReactNode } from 'react';

interface Props {
  term: string;
  children: ReactNode;
}

export function InlineDef({ term, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="border-b border-dotted border-[color:var(--color-accent)] hover:text-[color:var(--color-accent)]"
      >
        {term}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1 z-10 w-72 rounded-md bg-[color:var(--color-fig-bg)] text-[color:var(--color-fig-fg)] font-sans text-sm p-3 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}
