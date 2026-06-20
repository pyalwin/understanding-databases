import React, { type ReactNode } from 'react';

interface Props {
  n: number;
  children?: ReactNode;
}

export function Footnote({ n, children }: Props) {
  if (!children) {
    return (
      <a
        href={`#fn-${n}`}
        id={`fnref-${n}`}
        className="align-super text-[0.75em] text-[color:var(--color-accent)] no-underline"
      >
        [{n}]
      </a>
    );
  }
  return (
    <li id={`fn-${n}`} className="text-sm text-[color:var(--color-ink-soft)] mb-2">
      <a href={`#fnref-${n}`} className="text-[color:var(--color-accent)] mr-2">[{n}]</a>
      {children}
    </li>
  );
}
